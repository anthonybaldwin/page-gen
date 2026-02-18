import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export const agentRoutes = new Hono();

// List agent executions for a chat
agentRoutes.get("/executions", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) return c.json({ error: "chatId required" }, 400);

  const executions = await db
    .select()
    .from(schema.agentExecutions)
    .where(eq(schema.agentExecutions.chatId, chatId))
    .all();
  return c.json(executions);
});

// Trigger orchestration (placeholder - implemented in Milestone 4)
agentRoutes.post("/run", async (c) => {
  return c.json({ error: "Not yet implemented" }, 501);
});
