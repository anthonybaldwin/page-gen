import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { abortOrchestration } from "../agents/orchestrator.ts";
import { log } from "../services/logger.ts";

export const chatRoutes = new Hono();

// List chats for a project
chatRoutes.get("/", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) {
    const allChats = await db.select().from(schema.chats).all();
    return c.json(allChats);
  }
  const chats = await db.select().from(schema.chats).where(eq(schema.chats.projectId, projectId)).all();
  return c.json(chats);
});

// Get single chat
chatRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const chat = await db.select().from(schema.chats).where(eq(schema.chats.id, id)).get();
  if (!chat) return c.json({ error: "Chat not found" }, 404);
  return c.json(chat);
});

// Create chat
chatRoutes.post("/", async (c) => {
  const body = await c.req.json<{ projectId: string; title: string }>();
  const id = nanoid();
  const now = Date.now();

  const chat = {
    id,
    projectId: body.projectId,
    title: body.title,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.chats).values(chat);
  log("chat", `Created chat "${body.title}"`, { chatId: id, projectId: body.projectId });
  return c.json(chat, 201);
});

// Rename chat
chatRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ title: string }>();
  const now = Date.now();
  const updated = await db
    .update(schema.chats)
    .set({ title: body.title, updatedAt: now })
    .where(eq(schema.chats.id, id))
    .returning()
    .get();
  if (!updated) return c.json({ error: "Chat not found" }, 404);
  log("chat", `Renamed chat ${id} to "${body.title}"`);
  return c.json(updated);
});

// Delete chat (cascade: token_usage → agent_executions → pipeline_runs → messages, nullify snapshots)
chatRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  abortOrchestration(id);
  await db.delete(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, id));
  await db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, id));
  await db.delete(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, id));
  await db.delete(schema.messages).where(eq(schema.messages.chatId, id));
  await db
    .update(schema.snapshots)
    .set({ chatId: null })
    .where(eq(schema.snapshots.chatId, id));
  await db.delete(schema.chats).where(eq(schema.chats.id, id));
  log("chat", `Deleted chat ${id}`);
  return c.json({ ok: true });
});
