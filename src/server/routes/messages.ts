import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export const messageRoutes = new Hono();

// List messages for a chat
messageRoutes.get("/", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ error: "chatId required" }, 400);

  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.chatId, chatId)).all();
  return c.json(msgs);
});

// Create message
messageRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    chatId: string;
    role: string;
    content: string;
    agentName?: string;
    metadata?: Record<string, unknown>;
  }>();

  const id = nanoid();
  const now = Date.now();

  const message = {
    id,
    chatId: body.chatId,
    role: body.role,
    content: body.content,
    agentName: body.agentName || null,
    metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    createdAt: now,
  };

  await db.insert(schema.messages).values(message);
  return c.json(message, 201);
});
