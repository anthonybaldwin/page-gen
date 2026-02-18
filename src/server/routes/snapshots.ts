import { Hono } from "hono";
import { listSnapshots, getSnapshot, createSnapshot, rollbackSnapshot } from "../services/snapshot.ts";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export const snapshotRoutes = new Hono();

// List snapshots for a project
snapshotRoutes.get("/", (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);
  return c.json(listSnapshots(projectId));
});

// Get single snapshot
snapshotRoutes.get("/:id", (c) => {
  const id = c.req.param("id");
  const snap = getSnapshot(id);
  if (!snap) return c.json({ error: "Snapshot not found" }, 404);
  return c.json(snap);
});

// Create snapshot
snapshotRoutes.post("/", async (c) => {
  const body = await c.req.json<{ projectId: string; label?: string; chatId?: string }>();

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, body.projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const label = body.label || `Snapshot ${new Date().toISOString()}`;
  const result = createSnapshot(body.projectId, project.path, label, body.chatId);
  return c.json(result, 201);
});

// Rollback to snapshot
snapshotRoutes.post("/:id/rollback", async (c) => {
  const id = c.req.param("id");
  const snap = getSnapshot(id);
  if (!snap) return c.json({ error: "Snapshot not found" }, 404);

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, snap.projectId))
    .get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const success = rollbackSnapshot(id, project.path);
  if (!success) return c.json({ error: "Rollback failed" }, 500);
  return c.json({ ok: true, restoredTo: id });
});
