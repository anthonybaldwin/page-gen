import { db, schema } from "../db/index.ts";
import { nanoid } from "nanoid";
import { hashApiKey } from "../providers/registry.ts";
import { estimateCost } from "./pricing.ts";
import { eq, sql } from "drizzle-orm";

interface TrackTokensParams {
  executionId: string;
  chatId: string;
  agentName: string;
  provider: string;
  model: string;
  apiKey: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  projectId?: string;
  projectName?: string;
  chatTitle?: string;
}

export function trackTokenUsage(params: TrackTokensParams) {
  const totalTokens = params.inputTokens + params.outputTokens;
  const costEstimate = estimateCost(
    params.provider, params.model,
    params.inputTokens, params.outputTokens,
    params.cacheCreationInputTokens || 0, params.cacheReadInputTokens || 0,
  );
  const now = Date.now();
  const apiKeyHash = hashApiKey(params.apiKey);

  const record = {
    id: nanoid(),
    executionId: params.executionId,
    chatId: params.chatId,
    agentName: params.agentName,
    provider: params.provider,
    model: params.model,
    apiKeyHash,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens,
    costEstimate,
    createdAt: now,
  };

  // Operational record (deleted with chat/project)
  db.insert(schema.tokenUsage).values(record).run();

  // Permanent ledger record (never deleted)
  db.insert(schema.billingLedger).values({
    id: nanoid(),
    projectId: params.projectId || null,
    projectName: params.projectName || null,
    chatId: params.chatId,
    chatTitle: params.chatTitle || null,
    executionId: params.executionId,
    agentName: params.agentName,
    provider: params.provider,
    model: params.model,
    apiKeyHash,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens,
    costEstimate,
    createdAt: now,
  }).run();

  return record;
}

export function getSessionTokenTotal(chatId: string): number {
  const result = db
    .select({ total: sql<number>`sum(${schema.tokenUsage.totalTokens})` })
    .from(schema.tokenUsage)
    .where(eq(schema.tokenUsage.chatId, chatId))
    .get();
  return result?.total || 0;
}

export function getUsageByAgent(chatId: string) {
  return db
    .select()
    .from(schema.tokenUsage)
    .where(eq(schema.tokenUsage.chatId, chatId))
    .all();
}
