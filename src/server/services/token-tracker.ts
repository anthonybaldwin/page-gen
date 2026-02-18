import { db, schema } from "../db/index.ts";
import { nanoid } from "nanoid";
import { hashApiKey } from "../providers/registry.ts";
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
}

export function trackTokenUsage(params: TrackTokensParams) {
  const totalTokens = params.inputTokens + params.outputTokens;
  const costEstimate = estimateCost(params.provider, params.model, params.inputTokens, params.outputTokens);

  const record = {
    id: nanoid(),
    executionId: params.executionId,
    chatId: params.chatId,
    agentName: params.agentName,
    provider: params.provider,
    model: params.model,
    apiKeyHash: hashApiKey(params.apiKey),
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens,
    costEstimate,
    createdAt: Date.now(),
  };

  db.insert(schema.tokenUsage).values(record).run();
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

// Cost estimation per 1M tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "gpt-5.2": { input: 2.5, output: 10 },
  "gpt-5.2-pro": { input: 15, output: 60 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
};

function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING[model] || { input: 1, output: 5 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
