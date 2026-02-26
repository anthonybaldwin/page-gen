import { db, schema } from "../db/index.ts";
import { nanoid } from "nanoid";
import { hashApiKey } from "../providers/registry.ts";
import { estimateCost } from "./pricing.ts";
import { eq, sql } from "drizzle-orm";
import { log } from "./logger.ts";

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
  const totalTokens = params.inputTokens + params.outputTokens
    + (params.cacheCreationInputTokens || 0) + (params.cacheReadInputTokens || 0);
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
    cacheCreationInputTokens: params.cacheCreationInputTokens || 0,
    cacheReadInputTokens: params.cacheReadInputTokens || 0,
    costEstimate,
    estimated: 0,
    createdAt: now,
  };

  // Dual-write in a transaction to ensure atomicity
  db.transaction((tx) => {
    // Operational record (deleted with chat/project)
    tx.insert(schema.tokenUsage).values(record).run();

    // Permanent ledger record (never deleted)
    tx.insert(schema.billingLedger).values({
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
      cacheCreationInputTokens: params.cacheCreationInputTokens || 0,
      cacheReadInputTokens: params.cacheReadInputTokens || 0,
      costEstimate,
      estimated: 0,
      createdAt: now,
    }).run();
  });

  log("billing", `${params.agentName} usage: ${params.model}`, {
    agent: params.agentName, provider: params.provider, model: params.model,
    inputTokens: params.inputTokens, outputTokens: params.outputTokens,
    cacheCreate: params.cacheCreationInputTokens || 0, cacheRead: params.cacheReadInputTokens || 0,
    cost: costEstimate,
  });

  return record;
}

/**
 * Track billing only — inserts into billing_ledger (no FK constraints)
 * and skips token_usage. Use for system/non-chat calls (e.g., validate-key)
 * where there is no matching agentExecutions or chats record.
 */
export function trackBillingOnly(params: Omit<TrackTokensParams, "executionId" | "chatId"> & { chatId?: string; executionId?: string }) {
  const totalTokens = params.inputTokens + params.outputTokens
    + (params.cacheCreationInputTokens || 0) + (params.cacheReadInputTokens || 0);
  const costEstimate = estimateCost(
    params.provider, params.model,
    params.inputTokens, params.outputTokens,
    params.cacheCreationInputTokens || 0, params.cacheReadInputTokens || 0,
  );
  const now = Date.now();
  const apiKeyHash = hashApiKey(params.apiKey);

  log("billing", `${params.agentName} billing-only: ${params.model}`, {
    agent: params.agentName, provider: params.provider, model: params.model,
    totalTokens, cost: costEstimate,
  });

  db.insert(schema.billingLedger).values({
    id: nanoid(),
    projectId: params.projectId || null,
    projectName: params.projectName || null,
    chatId: params.chatId || null,
    chatTitle: params.chatTitle || null,
    executionId: params.executionId || null,
    agentName: params.agentName,
    provider: params.provider,
    model: params.model,
    apiKeyHash,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens,
    cacheCreationInputTokens: params.cacheCreationInputTokens || 0,
    cacheReadInputTokens: params.cacheReadInputTokens || 0,
    costEstimate,
    estimated: 0,
    createdAt: now,
  }).run();

  return { costEstimate, totalTokens };
}

/**
 * Insert provisional (estimated) token usage records BEFORE an LLM call.
 * If the call completes, these are finalized with actual values.
 * If the server crashes, provisional records remain as best-effort billing.
 */
export function trackProvisionalUsage(params: {
  executionId: string;
  chatId: string;
  agentName: string;
  provider: string;
  model: string;
  apiKey: string;
  estimatedInputTokens: number;
  projectId?: string;
  projectName?: string;
  chatTitle?: string;
}): { tokenUsageId: string; billingLedgerId: string } {
  const estimatedOutput = Math.ceil(params.estimatedInputTokens * 0.3);
  const totalTokens = params.estimatedInputTokens + estimatedOutput;
  const costEstimate = estimateCost(
    params.provider, params.model,
    params.estimatedInputTokens, estimatedOutput,
    0, 0,
  );
  const now = Date.now();
  const apiKeyHash = hashApiKey(params.apiKey);

  const tokenUsageId = nanoid();
  const billingLedgerId = nanoid();

  log("billing", `${params.agentName} provisional: ${params.model} ~${totalTokens} tokens ~$${costEstimate.toFixed(4)}`, {
    agent: params.agentName, provider: params.provider, model: params.model,
    estimatedTokens: totalTokens, estimatedCost: costEstimate,
  });

  // Dual-write in a transaction to ensure atomicity
  db.transaction((tx) => {
    tx.insert(schema.tokenUsage).values({
      id: tokenUsageId,
      executionId: params.executionId,
      chatId: params.chatId,
      agentName: params.agentName,
      provider: params.provider,
      model: params.model,
      apiKeyHash,
      inputTokens: params.estimatedInputTokens,
      outputTokens: estimatedOutput,
      totalTokens,
      costEstimate,
      estimated: 1,
      createdAt: now,
    }).run();

    tx.insert(schema.billingLedger).values({
      id: billingLedgerId,
      projectId: params.projectId || null,
      projectName: params.projectName || null,
      chatId: params.chatId,
      chatTitle: params.chatTitle || null,
      executionId: params.executionId,
      agentName: params.agentName,
      provider: params.provider,
      model: params.model,
      apiKeyHash,
      inputTokens: params.estimatedInputTokens,
      outputTokens: estimatedOutput,
      totalTokens,
      costEstimate,
      estimated: 1,
      createdAt: now,
    }).run();
  });

  return { tokenUsageId, billingLedgerId };
}

/**
 * Void (delete) provisional token records when an LLM call fails cleanly.
 * Removes the write-ahead records so failed calls leave no phantom billing trace.
 */
export function voidProvisionalUsage(ids: { tokenUsageId: string; billingLedgerId: string }): void {
  log("billing", `Provisional voided`, { tokenUsageId: ids.tokenUsageId, billingLedgerId: ids.billingLedgerId });
  db.transaction((tx) => {
    tx.delete(schema.tokenUsage).where(eq(schema.tokenUsage.id, ids.tokenUsageId)).run();
    tx.delete(schema.billingLedger).where(eq(schema.billingLedger.id, ids.billingLedgerId)).run();
  });
}

/**
 * Finalize provisional token records with actual values from the LLM response.
 * Sets estimated=0 and updates all token/cost fields.
 */
export function finalizeTokenUsage(
  ids: { tokenUsageId: string; billingLedgerId: string },
  actual: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  },
  provider: string,
  model: string,
): void {
  const totalTokens = actual.inputTokens + actual.outputTokens
    + (actual.cacheCreationInputTokens || 0) + (actual.cacheReadInputTokens || 0);
  const costEstimate = estimateCost(
    provider, model,
    actual.inputTokens, actual.outputTokens,
    actual.cacheCreationInputTokens || 0, actual.cacheReadInputTokens || 0,
  );

  log("billing", `Finalized: ${model} ${totalTokens} tokens $${costEstimate.toFixed(4)}`, {
    provider, model,
    inputTokens: actual.inputTokens, outputTokens: actual.outputTokens,
    cacheCreate: actual.cacheCreationInputTokens || 0, cacheRead: actual.cacheReadInputTokens || 0,
    totalTokens, cost: costEstimate,
  });

  // Dual-write in a transaction to ensure atomicity
  db.transaction((tx) => {
    tx.update(schema.tokenUsage)
      .set({
        inputTokens: actual.inputTokens,
        outputTokens: actual.outputTokens,
        totalTokens,
        cacheCreationInputTokens: actual.cacheCreationInputTokens || 0,
        cacheReadInputTokens: actual.cacheReadInputTokens || 0,
        costEstimate,
        estimated: 0,
      })
      .where(eq(schema.tokenUsage.id, ids.tokenUsageId))
      .run();

    tx.update(schema.billingLedger)
      .set({
        inputTokens: actual.inputTokens,
        outputTokens: actual.outputTokens,
        totalTokens,
        cacheCreationInputTokens: actual.cacheCreationInputTokens || 0,
        cacheReadInputTokens: actual.cacheReadInputTokens || 0,
        costEstimate,
        estimated: 0,
      })
      .where(eq(schema.billingLedger.id, ids.billingLedgerId))
      .run();
  });
}

/**
 * Count provisional (estimated=1) records. Used on startup to log
 * how many records survived from interrupted pipelines.
 */
export function countProvisionalRecords(): number {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.billingLedger)
    .where(eq(schema.billingLedger.estimated, 1))
    .get();
  return result?.count || 0;
}

/**
 * Finalize orphaned provisional records by setting estimated=0.
 * Called on startup to clean up records from interrupted pipelines.
 * The rough estimates are kept as-is — they're the best we have.
 * Returns the number of records finalized.
 */
export function finalizeOrphanedProvisionalRecords(): number {
  const count = countProvisionalRecords();
  if (count === 0) return 0;

  db.update(schema.billingLedger)
    .set({ estimated: 0 })
    .where(eq(schema.billingLedger.estimated, 1))
    .run();

  db.update(schema.tokenUsage)
    .set({ estimated: 0 })
    .where(eq(schema.tokenUsage.estimated, 1))
    .run();

  return count;
}

/**
 * Get estimated token total (provisional records only) for usage summary.
 */
export function getEstimatedTokenTotal(): number {
  const result = db
    .select({ total: sql<number>`sum(${schema.billingLedger.totalTokens})` })
    .from(schema.billingLedger)
    .where(eq(schema.billingLedger.estimated, 1))
    .get();
  return result?.total || 0;
}

export function getSessionTokenTotal(chatId: string): number {
  const result = db
    .select({ total: sql<number>`sum(${schema.tokenUsage.totalTokens})` })
    .from(schema.tokenUsage)
    .where(eq(schema.tokenUsage.chatId, chatId))
    .get();
  return result?.total || 0;
}

