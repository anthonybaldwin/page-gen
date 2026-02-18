import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

export const usageRoutes = new Hono();

// Get usage for a chat
usageRoutes.get("/", async (c) => {
  const chatId = c.req.query("chatId");
  if (!chatId) {
    const all = await db.select().from(schema.tokenUsage).all();
    return c.json(all);
  }
  const usage = await db.select().from(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chatId)).all();
  return c.json(usage);
});

// Get usage summary
usageRoutes.get("/summary", async (c) => {
  const all = await db.select().from(schema.tokenUsage).all();
  const totalTokens = all.reduce((sum, u) => sum + u.totalTokens, 0);
  const totalCost = all.reduce((sum, u) => sum + u.costEstimate, 0);
  return c.json({ totalTokens, totalCost, requestCount: all.length });
});
