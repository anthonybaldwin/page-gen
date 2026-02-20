import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, relative } from "path";
import { zipSync, strToU8 } from "fflate";
import type { FileNode } from "../../shared/types.ts";
import { startPreviewServer, getPreviewUrl, stopPreviewServer } from "../preview/vite-server.ts";
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

// List file tree for a project
fileRoutes.get("/tree/:projectId", (c) => {
  const projectId = c.req.param("projectId");
  const projectPath = `./projects/${projectId}`;
  if (!existsSync(projectPath)) return c.json({ error: "Project not found" }, 404);
  const tree = buildFileTree(projectPath);
  return c.json(tree);
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
