import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";

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

// Usage summary (lifetime totals from billing_ledger — survives deletions)
usageRoutes.get("/summary", (c) => {
  const result = db
    .select({
      totalInputTokens: sql<number>`sum(${schema.billingLedger.inputTokens})`,
      totalOutputTokens: sql<number>`sum(${schema.billingLedger.outputTokens})`,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger)
    .get();

  return c.json({
    totalInputTokens: result?.totalInputTokens || 0,
    totalOutputTokens: result?.totalOutputTokens || 0,
    totalTokens: result?.totalTokens || 0,
    totalCost: result?.totalCost || 0,
    requestCount: result?.requestCount || 0,
  });
});

// Usage grouped by agent (from billing_ledger — survives deletions)
usageRoutes.get("/by-agent", (c) => {
  const chatId = c.req.query("chatId");
  const baseQuery = db
    .select({
      agentName: schema.billingLedger.agentName,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger);

  if (chatId) {
    const results = baseQuery
      .where(eq(schema.billingLedger.chatId, chatId))
      .groupBy(schema.billingLedger.agentName)
      .all();
    return c.json(results);
  }

  const results = baseQuery.groupBy(schema.billingLedger.agentName).all();
  return c.json(results);
});

// Usage grouped by provider (from billing_ledger — survives deletions)
usageRoutes.get("/by-provider", (c) => {
  const results = db
    .select({
      provider: schema.billingLedger.provider,
      model: schema.billingLedger.model,
      totalTokens: sql<number>`sum(${schema.billingLedger.totalTokens})`,
      totalCost: sql<number>`sum(${schema.billingLedger.costEstimate})`,
      requestCount: sql<number>`count(*)`,
    })
    .from(schema.billingLedger)
    .groupBy(schema.billingLedger.provider, schema.billingLedger.model)
    .all();
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
