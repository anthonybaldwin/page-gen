import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import {
  checkGitAvailable,
  listVersions,
  userCommit,
  rollbackToVersion,
  getDiff,
  ensureGitRepo,
} from "../services/versioning.ts";

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
  const sha = userCommit(project.path, label);

  if (!sha) {
    return c.json({ sha: null, note: "No changes to save" });
  }

  return c.json({ sha, label }, 201);
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

  const success = rollbackToVersion(project.path, sha);
  if (!success) return c.json({ error: "Rollback failed" }, 500);

  return c.json({ ok: true, restoredTo: sha });
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
