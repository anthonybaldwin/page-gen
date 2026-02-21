import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import {
  checkGitAvailable,
  listVersions,
  userCommit,
  rollbackToVersion,
  deleteVersion,
  getDiff,
  getFileTreeAtVersion,
  ensureGitRepo,
  enterPreview,
  exitPreview,
  getPreviewInfo,
} from "../services/versioning.ts";
import { broadcastFilesChanged, broadcast } from "../ws.ts";

export const versionRoutes = new Hono();

// List version history for a project
versionRoutes.get("/", (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  // Ensure git repo exists (lazy init)
  ensureGitRepo(project.path);

  const versions = listVersions(project.path);
  return c.json(versions);
});

// Create a user version (manual save)
versionRoutes.post("/", async (c) => {
  const body = await c.req.json<{ projectId: string; label?: string }>();

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, body.projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const label = body.label || `Saved ${new Date().toISOString()}`;
  const result = userCommit(project.path, label);

  if (!result.sha) {
    return c.json({ sha: null, note: (result as { sha: null; reason: string }).reason });
  }

  return c.json({ sha: result.sha, label }, 201);
});

// Rollback to a specific version
versionRoutes.post("/:sha/rollback", async (c) => {
  const sha = c.req.param("sha");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = rollbackToVersion(project.path, sha);
  if (!result.ok) return c.json({ error: result.error || "Rollback failed" }, 500);

  return c.json({ ok: true, restoredTo: sha });
});

// Delete a specific version (squash it out of history)
versionRoutes.delete("/:sha", (c) => {
  const sha = c.req.param("sha");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = deleteVersion(project.path, sha);
  if (!result.ok) return c.json({ error: result.error || "Delete failed" }, 400);

  return c.json({ ok: true });
});

// Get diff for a specific version
versionRoutes.get("/:sha/diff", (c) => {
  const sha = c.req.param("sha");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = getDiff(project.path, sha);
  if (!result) return c.json({ error: "Diff not available" }, 404);

  return c.json(result);
});

// Get file tree at a specific version
versionRoutes.get("/:sha/tree", (c) => {
  const sha = c.req.param("sha");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const files = getFileTreeAtVersion(project.path, sha);
  if (files === null) return c.json({ error: "File tree not available" }, 404);

  return c.json({ files });
});

// --- Version Preview endpoints ---

// Enter preview mode for a specific version
versionRoutes.post("/:sha/preview", (c) => {
  const sha = c.req.param("sha");
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  if (!checkGitAvailable()) {
    return c.json({ error: "Git is not available", gitUnavailable: true }, 503);
  }

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = enterPreview(project.path, sha);
  if (!result.ok) return c.json({ error: result.error || "Preview failed" }, 400);

  broadcastFilesChanged(projectId, ["__checkout__"]);
  return c.json({ ok: true, sha });
});

// Exit preview mode
versionRoutes.delete("/preview", (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const result = exitPreview(project.path, { clean: true });
  if (!result.ok) return c.json({ error: result.error || "Exit preview failed" }, 500);

  broadcastFilesChanged(projectId, ["__checkout__"]);
  return c.json({ ok: true });
});

// Get current preview status
versionRoutes.get("/preview", (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const info = getPreviewInfo(project.path);
  if (!info) return c.json({ previewing: false });

  return c.json({ previewing: true, sha: info.previewSha, originalHead: info.originalHead });
});
