import { Hono } from "hono";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "fs";
import { join, dirname, relative } from "path";
import type { FileNode } from "../../shared/types.ts";

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
  return c.json({ ok: true, path: body.path });
});
