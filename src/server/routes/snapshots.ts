import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export const snapshotRoutes = new Hono();

// List snapshots for a project
snapshotRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const snaps = await db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.projectId, projectId))
    .all();
  return c.json(snaps);
});

// Get single snapshot
snapshotRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const snap = await db.select().from(schema.snapshots).where(eq(schema.snapshots.id, id)).get();
  if (!snap) return c.json({ error: "Snapshot not found" }, 404);
  return c.json(snap);
});
