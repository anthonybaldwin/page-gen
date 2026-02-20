import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";
import { getEstimatedTokenTotal } from "../services/token-tracker.ts";

export const usageRoutes = new Hono();

/** Build WHERE conditions from common query params (chatId, from, to). */
function buildFilters(c: { req: { query: (k: string) => string | undefined } }) {
  const projectId = c.req.query("projectId");
  const chatId = c.req.query("chatId");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const conditions = [];
  if (projectId) conditions.push(eq(schema.billingLedger.projectId, projectId));
  if (chatId) conditions.push(eq(schema.billingLedger.chatId, chatId));
  if (from) conditions.push(gte(schema.billingLedger.createdAt, parseInt(from, 10)));
  if (to) conditions.push(lte(schema.billingLedger.createdAt, parseInt(to, 10)));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

// Distinct chats from billing_ledger (for filter dropdown)
usageRoutes.get("/chats", (c) => {
  const results = db
    .select({
      chatId: schema.billingLedger.chatId,
      chatTitle: schema.billingLedger.chatTitle,
      projectName: schema.billingLedger.projectName,
    })
    .from(schema.billingLedger)
    .groupBy(schema.billingLedger.chatId)
    .orderBy(desc(sql`max(${schema.billingLedger.createdAt})`))
    .all();
  return c.json(results);
});

// Get all usage records (from billing_ledger — survives deletions)
usageRoutes.get("/", (c) => {
  const where = buildFilters(c);
  const results = where
    ? db.select().from(schema.billingLedger).where(where).orderBy(desc(schema.billingLedger.createdAt)).all()
    : db.select().from(schema.billingLedger).orderBy(desc(schema.billingLedger.createdAt)).all();
  return c.json(results);
});

// Usage summary (from billing_ledger — survives deletions)
usageRoutes.get("/summary", (c) => {
  const where = buildFilters(c);
  const query = db
    .select({
      totalInputTokens: sql<number>`sum(${schema.billingLedger.inputTokens})`,
      totalOutputTokens: sql<number>`sum(${schema.billingLedger.outputTokens})`,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCacheCreationTokens: sql<number>`sum(${schema.billingLedger.cacheCreationInputTokens})`,
      totalCacheReadTokens: sql<number>`sum(${schema.billingLedger.cacheReadInputTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger);

  const result = where ? query.where(where).get() : query.get();

  return c.json({
    totalInputTokens: result?.totalInputTokens || 0,
    totalOutputTokens: result?.totalOutputTokens || 0,
    totalTokens: result?.totalTokens || 0,
    totalCacheCreationTokens: result?.totalCacheCreationTokens || 0,
    totalCacheReadTokens: result?.totalCacheReadTokens || 0,
    totalCost: result?.totalCost || 0,
    requestCount: result?.requestCount || 0,
    estimatedTokens: getEstimatedTokenTotal(),
  });
});

// Usage grouped by agent with models used (from billing_ledger — survives deletions)
usageRoutes.get("/by-agent", (c) => {
  const where = buildFilters(c);
  const query = db
    .select({
      agentName: schema.billingLedger.agentName,
      models: sql<string>`group_concat(distinct ${schema.billingLedger.model})`,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCacheCreationTokens: sql<number>`sum(${schema.billingLedger.cacheCreationInputTokens})`,
      totalCacheReadTokens: sql<number>`sum(${schema.billingLedger.cacheReadInputTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger);

  const results = where
    ? query.where(where).groupBy(schema.billingLedger.agentName).all()
    : query.groupBy(schema.billingLedger.agentName).all();
  return c.json(results);
});

// Usage grouped by model (provider + model) (from billing_ledger — survives deletions)
usageRoutes.get("/by-model", (c) => {
  const where = buildFilters(c);
  const query = db
    .select({
      provider: schema.billingLedger.provider,
      model: schema.billingLedger.model,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCacheCreationTokens: sql<number>`sum(${schema.billingLedger.cacheCreationInputTokens})`,
      totalCacheReadTokens: sql<number>`sum(${schema.billingLedger.cacheReadInputTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger);

  const results = where
    ? query.where(where).groupBy(schema.billingLedger.provider, schema.billingLedger.model).all()
    : query.groupBy(schema.billingLedger.provider, schema.billingLedger.model).all();
  return c.json(results);
});

// Usage grouped by provider only (from billing_ledger — survives deletions)
usageRoutes.get("/by-provider", (c) => {
  const where = buildFilters(c);
  const query = db
    .select({
      provider: schema.billingLedger.provider,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCacheCreationTokens: sql<number>`sum(${schema.billingLedger.cacheCreationInputTokens})`,
      totalCacheReadTokens: sql<number>`sum(${schema.billingLedger.cacheReadInputTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger);

  const results = where
    ? query.where(where).groupBy(schema.billingLedger.provider).all()
    : query.groupBy(schema.billingLedger.provider).all();
  return c.json(results);
});

// Lifetime usage grouped by project (from billing_ledger)
usageRoutes.get("/by-project", (c) => {
  const results = db
    .select({
      projectId: schema.billingLedger.projectId,
      projectName: schema.billingLedger.projectName,
      totalInputTokens: sql<number>`sum(${schema.billingLedger.inputTokens})`,
      totalOutputTokens: sql<number>`sum(${schema.billingLedger.outputTokens})`,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCacheCreationTokens: sql<number>`sum(${schema.billingLedger.cacheCreationInputTokens})`,
      totalCacheReadTokens: sql<number>`sum(${schema.billingLedger.cacheReadInputTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger)
    .groupBy(schema.billingLedger.projectId)
    .all();
  return c.json(results);
});

// Full billing history (from billing_ledger — never deleted)
usageRoutes.get("/history", (c) => {
  const projectId = c.req.query("projectId");
  const chatId = c.req.query("chatId");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [];
  if (projectId) conditions.push(eq(schema.billingLedger.projectId, projectId));
  if (chatId) conditions.push(eq(schema.billingLedger.chatId, chatId));
  if (from) conditions.push(gte(schema.billingLedger.createdAt, parseInt(from, 10)));
  if (to) conditions.push(lte(schema.billingLedger.createdAt, parseInt(to, 10)));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = whereClause
    ? db.select().from(schema.billingLedger).where(whereClause).orderBy(desc(schema.billingLedger.createdAt)).all()
    : db.select().from(schema.billingLedger).orderBy(desc(schema.billingLedger.createdAt)).all();

  return c.json(results);
});

// Reset all billing data (for fresh testing)
usageRoutes.delete("/reset", (c) => {
  const tokenUsageCount = db.select({ count: sql<number>`count(*)` }).from(schema.tokenUsage).get()?.count || 0;
  const billingCount = db.select({ count: sql<number>`count(*)` }).from(schema.billingLedger).get()?.count || 0;
  db.delete(schema.tokenUsage).run();
  db.delete(schema.billingLedger).run();
  return c.json({
    ok: true,
    deleted: {
      tokenUsage: tokenUsageCount,
      billingLedger: billingCount,
    },
  });
});
