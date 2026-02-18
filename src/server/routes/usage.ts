import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, sql, desc } from "drizzle-orm";

export const usageRoutes = new Hono();

// Get all usage records (optionally filtered by chatId)
usageRoutes.get("/", (c) => {
  const chatId = c.req.query("chatId");
  if (chatId) {
    const usage = db
      .select()
      .from(schema.tokenUsage)
      .where(eq(schema.tokenUsage.chatId, chatId))
      .orderBy(desc(schema.tokenUsage.createdAt))
      .all();
    return c.json(usage);
  }
  const all = db
    .select()
    .from(schema.tokenUsage)
    .orderBy(desc(schema.tokenUsage.createdAt))
    .all();
  return c.json(all);
});

// Usage summary (totals)
usageRoutes.get("/summary", (c) => {
  const result = db
    .select({
      totalInputTokens: sql<number>`sum(${schema.tokenUsage.inputTokens})`,
      totalOutputTokens: sql<number>`sum(${schema.tokenUsage.outputTokens})`,
      totalTokens: sql<number>`sum(${schema.tokenUsage.totalTokens})`,
      totalCost: sql<number>`sum(${schema.tokenUsage.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.tokenUsage)
    .get();

  return c.json({
    totalInputTokens: result?.totalInputTokens || 0,
    totalOutputTokens: result?.totalOutputTokens || 0,
    totalTokens: result?.totalTokens || 0,
    totalCost: result?.totalCost || 0,
    requestCount: result?.requestCount || 0,
  });
});

// Usage grouped by agent
usageRoutes.get("/by-agent", (c) => {
  const chatId = c.req.query("chatId");
  const baseQuery = db
    .select({
      agentName: schema.tokenUsage.agentName,
      totalTokens: sql<number>`sum(${schema.tokenUsage.totalTokens})`,
      totalCost: sql<number>`sum(${schema.tokenUsage.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.tokenUsage);

  if (chatId) {
    const results = baseQuery
      .where(eq(schema.tokenUsage.chatId, chatId))
      .groupBy(schema.tokenUsage.agentName)
      .all();
    return c.json(results);
  }

  const results = baseQuery.groupBy(schema.tokenUsage.agentName).all();
  return c.json(results);
});

// Usage grouped by provider
usageRoutes.get("/by-provider", (c) => {
  const results = db
    .select({
      provider: schema.tokenUsage.provider,
      model: schema.tokenUsage.model,
      totalTokens: sql<number>`sum(${schema.tokenUsage.totalTokens})`,
      totalCost: sql<number>`sum(${schema.tokenUsage.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.tokenUsage)
    .groupBy(schema.tokenUsage.provider, schema.tokenUsage.model)
    .all();
  return c.json(results);
});
