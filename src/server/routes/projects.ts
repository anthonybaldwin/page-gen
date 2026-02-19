import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mkdirSync, rmSync } from "fs";
import { abortOrchestration } from "../agents/orchestrator.ts";

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

// Rename project
projectRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name: string }>();
  const now = Date.now();
  const updated = await db
    .update(schema.projects)
    .set({ name: body.name, updatedAt: now })
    .where(eq(schema.projects.id, id))
    .returning()
    .get();
  if (!updated) return c.json({ error: "Project not found" }, 404);
  return c.json(updated);
});

// Delete project (cascade: all chats + children, snapshots, disk cleanup)
projectRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Fetch all chats for this project
  const projectChats = await db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(eq(schema.chats.projectId, id))
    .all();

  // Abort any active orchestrations and delete children for each chat
  for (const chat of projectChats) {
    abortOrchestration(chat.id);
    await db.delete(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chat.id));
    await db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chat.id));
    await db.delete(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, chat.id));
    await db.delete(schema.messages).where(eq(schema.messages.chatId, chat.id));
  }

  // Delete snapshots, then chats, then project
  await db.delete(schema.snapshots).where(eq(schema.snapshots.projectId, id));
  await db.delete(schema.chats).where(eq(schema.chats.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id));

  // Remove project directory from disk
  try {
    rmSync(`./projects/${id}`, { recursive: true, force: true });
  } catch {
    // Directory may not exist — safe to ignore
  }

  return c.json({ ok: true });
});
