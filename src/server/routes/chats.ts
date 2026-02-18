import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

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
  return c.json(chat, 201);
});

// Delete chat
chatRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(schema.chats).where(eq(schema.chats.id, id));
  return c.json({ ok: true });
});
