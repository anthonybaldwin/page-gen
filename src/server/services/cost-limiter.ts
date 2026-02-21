import { getSessionTokenTotal } from "./token-tracker.ts";
import { getLimit } from "../routes/settings.ts";
import { db, schema } from "../db/index.ts";
import { eq, sql } from "drizzle-orm";
import { log, logWarn } from "./logger.ts";

const WARNING_THRESHOLD = 0.8;

export interface CostCheckResult {
  allowed: boolean;
  currentTokens: number;
  limit: number;
  percentUsed: number;
  warning: boolean;
}

export function checkCostLimit(chatId: string, limitOverride?: number): CostCheckResult {
  const limit = limitOverride ?? getLimit("maxTokensPerChat");
  const currentTokens = getSessionTokenTotal(chatId);
  const percentUsed = limit > 0 ? currentTokens / limit : 0;
  const allowed = limit <= 0 || currentTokens < limit;
  const warning = limit > 0 && percentUsed >= WARNING_THRESHOLD && percentUsed < 1;

  if (!allowed) {
    logWarn("billing", `Token limit exceeded for chat ${chatId}`, { chatId, currentTokens, limit });
  } else if (warning) {
    logWarn("billing", `Token usage warning for chat ${chatId}: ${(percentUsed * 100).toFixed(0)}%`, { chatId, currentTokens, limit, percentUsed });
  }

  return { allowed, currentTokens, limit, percentUsed, warning };
}

export function getMaxAgentCalls(): number {
  return getLimit("maxAgentCallsPerRun");
}

export function checkDailyCostLimit(): { allowed: boolean; currentCost: number; limit: number } {
  const limit = getLimit("maxCostPerDay");
  if (limit <= 0) return { allowed: true, currentCost: 0, limit: 0 };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const result = db
    .select({ total: sql<number>`coalesce(sum(${schema.billingLedger.costEstimate}), 0)` })
    .from(schema.billingLedger)
    .where(sql`${schema.billingLedger.createdAt} >= ${startOfDay.getTime()}`)
    .get();

  const currentCost = result?.total || 0;
  const allowed = currentCost < limit;
  if (!allowed) {
    logWarn("billing", `Daily cost limit exceeded: $${currentCost.toFixed(4)} / $${limit}`, { currentCost, limit });
  }
  return { allowed, currentCost, limit };
}

export function checkProjectCostLimit(projectId: string): { allowed: boolean; currentCost: number; limit: number } {
  const limit = getLimit("maxCostPerProject");
  if (limit <= 0) return { allowed: true, currentCost: 0, limit: 0 };

  const result = db
    .select({ total: sql<number>`coalesce(sum(${schema.billingLedger.costEstimate}), 0)` })
    .from(schema.billingLedger)
    .where(eq(schema.billingLedger.projectId, projectId))
    .get();

  const currentCost = result?.total || 0;
  const allowed = currentCost < limit;
  if (!allowed) {
    logWarn("billing", `Project cost limit exceeded: $${currentCost.toFixed(4)} / $${limit}`, { projectId, currentCost, limit });
  }
  return { allowed, currentCost, limit };
}

export function getCostLimitSettings() {
  return {
    defaultTokenLimit: getLimit("maxTokensPerChat"),
    warningThreshold: WARNING_THRESHOLD,
  };
}
