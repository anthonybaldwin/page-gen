import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mkdirSync } from "fs";

export const projectRoutes = new Hono();

// List all projects
projectRoutes.get("/", async (c) => {
  const allProjects = await db.select().from(schema.projects).all();
  return c.json(allProjects);
});

// Get single project
projectRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(project);
});

// Create project
projectRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const id = nanoid();
  const projectPath = `./projects/${id}`;
  const now = Date.now();

  mkdirSync(`${projectPath}/src`, { recursive: true });

  const project = {
    id,
    name: body.name,
    path: projectPath,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.projects).values(project);
  return c.json(project, 201);
});

// Delete project
projectRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
  return c.json({ ok: true });
});
