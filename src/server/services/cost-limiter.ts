import { getSessionTokenTotal } from "./token-tracker.ts";

const DEFAULT_TOKEN_LIMIT = 500_000;
const WARNING_THRESHOLD = 0.8;

interface CostCheckResult {
  allowed: boolean;
  currentTokens: number;
  limit: number;
  percentUsed: number;
  warning: boolean;
}

export function checkCostLimit(chatId: string, limit: number = DEFAULT_TOKEN_LIMIT): CostCheckResult {
  const currentTokens = getSessionTokenTotal(chatId);
  const percentUsed = currentTokens / limit;

  return {
    allowed: currentTokens < limit,
    currentTokens,
    limit,
    percentUsed,
    warning: percentUsed >= WARNING_THRESHOLD && percentUsed < 1,
  };
}

export function getCostLimitSettings() {
  return {
    defaultTokenLimit: DEFAULT_TOKEN_LIMIT,
    warningThreshold: WARNING_THRESHOLD,
  };
}
