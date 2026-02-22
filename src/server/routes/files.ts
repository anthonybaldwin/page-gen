import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, relative } from "path";
import { zipSync, strToU8 } from "fflate";
import type { FileNode, ContentSearchMatch, ContentSearchResult } from "../../shared/types.ts";
import { startPreviewServer, getPreviewUrl, stopPreviewServer } from "../preview/vite-server.ts";
import { stopBackendServer } from "../preview/backend-server.ts";
import { broadcastFilesChanged } from "../ws.ts";

export const fileRoutes = new Hono();

function buildFileTree(dir: string, basePath: string = ""): FileNode[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((entry) => {
      const fullPath = join(dir, entry.name);
      const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relPath,
          type: "directory" as const,
          children: buildFileTree(fullPath, relPath),
        };
      }
      return { name: entry.name, path: relPath, type: "file" as const };
    });
}

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp3", "mp4", "wav", "ogg", "webm", "avi",
  "pdf", "zip", "tar", "gz", "rar", "7z",
  "exe", "dll", "so", "dylib", "bin",
]);

const MAX_SEARCH_FILE_SIZE = 512 * 1024; // 512KB

function searchFiles(
  dir: string,
  query: string,
  basePath: string,
  results: ContentSearchResult[],
  maxResults: number,
): void {
  if (results.length >= maxResults) return;
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const fullPath = join(dir, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      searchFiles(fullPath, query, relPath, results, maxResults);
      continue;
    }

    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    if (BINARY_EXTENSIONS.has(ext)) continue;

    try {
      const stat = statSync(fullPath);
      if (stat.size > MAX_SEARCH_FILE_SIZE) continue;
    } catch {
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const lowerQuery = query.toLowerCase();
      const matches: ContentSearchMatch[] = [];

      for (let i = 0; i < lines.length && matches.length < 3; i++) {
        if (lines[i]!.toLowerCase().includes(lowerQuery)) {
          matches.push({
            line: i + 1,
            content: lines[i]!.substring(0, 200),
          });
        }
      }

      if (matches.length > 0) {
        results.push({ path: relPath, matches });
      }
    } catch {
      // skip unreadable files
    }
  }
}

// Search file contents in a project
fileRoutes.get("/search/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const query = c.req.query("q") ?? "";
  const maxResults = Math.min(Number(c.req.query("maxResults")) || 50, 100);

  if (query.length < 2) {
    return c.json({ error: "Query must be at least 2 characters" }, 400);
  }

  const projectPath = join("./projects", projectId);

  // Security: ensure path stays within project directory
  const resolved = join(process.cwd(), projectPath);
  const projectRoot = join(process.cwd(), "projects", projectId);
  if (!resolved.startsWith(projectRoot)) {
    return c.json({ error: "Access denied" }, 403);
  }

  if (!existsSync(projectPath)) {
    return c.json({ error: "Project not found" }, 404);
  }

  const results: ContentSearchResult[] = [];
  searchFiles(projectPath, query, "", results, maxResults);
  return c.json(results);
});

// List file tree for a project
fileRoutes.get("/tree/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const projectPath = `./projects/${projectId}`;
  if (!existsSync(projectPath)) return c.json({ error: "Project not found" }, 404);
  const tree = buildFileTree(projectPath);
  return c.json(tree);
});

// Serve raw binary file (images, fonts, etc.)
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  eot: "application/vnd.ms-fontobject",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "video/webm",
  pdf: "application/pdf",
  zip: "application/zip",
};

fileRoutes.get("/raw/:projectId/*", (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.path.replace(`/api/files/raw/${projectId}/`, "");
  const fullPath = join("./projects", projectId, filePath);

  const resolved = join(process.cwd(), fullPath);
  const projectRoot = join(process.cwd(), "projects", projectId);
  if (!resolved.startsWith(projectRoot)) {
    return c.json({ error: "Access denied" }, 403);
  }

  if (!existsSync(fullPath)) return c.json({ error: "File not found" }, 404);

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = readFileSync(fullPath);

  return new Response(content as unknown as BodyInit, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "no-cache",
    },
  });
});

// Read file content
fileRoutes.get("/read/:projectId/*", (c) => {
  const projectId = c.req.param("projectId");
  const filePath = c.req.path.replace(`/api/files/read/${projectId}/`, "");
  const fullPath = join("./projects", projectId, filePath);

  // Security: ensure path stays within project directory
  const resolved = join(process.cwd(), fullPath);
  const projectRoot = join(process.cwd(), "projects", projectId);
  if (!resolved.startsWith(projectRoot)) {
    return c.json({ error: "Access denied" }, 403);
  }

  if (!existsSync(fullPath)) return c.json({ error: "File not found" }, 404);
  const content = readFileSync(fullPath, "utf-8");
  return c.json({ path: filePath, content });
});

// Write file content
fileRoutes.post("/write/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ path: string; content: string }>();
  const fullPath = join("./projects", projectId, body.path);

  // Security: ensure path stays within project directory
  const resolved = join(process.cwd(), fullPath);
  const projectRoot = join(process.cwd(), "projects", projectId);
  if (!resolved.startsWith(projectRoot)) {
    return c.json({ error: "Access denied" }, 403);
  }

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body.content, "utf-8");
  broadcastFilesChanged(projectId, [body.path]);
  return c.json({ ok: true, path: body.path });
});

// Delete file
fileRoutes.delete("/delete/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json<{ path: string }>();
  const fullPath = join("./projects", projectId, body.path);

  const resolved = join(process.cwd(), fullPath);
  const projectRoot = join(process.cwd(), "projects", projectId);
  if (!resolved.startsWith(projectRoot)) {
    return c.json({ error: "Access denied" }, 403);
  }

  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
  return c.json({ ok: true });
});

// Start/get preview server for a project
fileRoutes.post("/preview/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const projectPath = `./projects/${projectId}`;

  // Check if already running
  const existingUrl = getPreviewUrl(projectId);
  if (existingUrl) {
    return c.json({ url: existingUrl });
  }

  try {
    const { url } = await startPreviewServer(projectId, projectPath);
    // Notify FileExplorer about scaffold files created during preview setup
    broadcastFilesChanged(projectId, ["__scaffold__"]);
    return c.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start preview";
    return c.json({ error: message }, 500);
  }
});

// Stop preview server for a project
fileRoutes.delete("/preview/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  await stopBackendServer(projectId);
  await stopPreviewServer(projectId);
  return c.json({ ok: true });
});

// Download project as zip
fileRoutes.get("/zip/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const projectPath = join("./projects", projectId);
  if (!existsSync(projectPath)) return c.json({ error: "Project not found" }, 404);

  const EXCLUDE = new Set(["node_modules", "dist", "build", ".git"]);

  function collectFiles(dir: string, basePath: string = ""): Record<string, Uint8Array> {
    const result: Record<string, Uint8Array> = {};
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || EXCLUDE.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        Object.assign(result, collectFiles(fullPath, relPath));
      } else {
        try {
          const content = readFileSync(fullPath);
          result[relPath] = new Uint8Array(content);
        } catch {
          // skip unreadable files
        }
      }
    }
    return result;
  }

  const files = collectFiles(join(process.cwd(), projectPath));
  const zipped = zipSync(files);

  return new Response(Buffer.from(zipped) as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${projectId}.zip"`,
    },
  });
});
