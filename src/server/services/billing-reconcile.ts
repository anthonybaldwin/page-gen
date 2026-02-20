export type ReconcileCacheMode = "create" | "read";

export interface BillingLedgerCostRow {
  id: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
}

export function inferCacheTokensFromLedgerRow(row: BillingLedgerCostRow): number {
  return Math.max(0, row.totalTokens - row.inputTokens - row.outputTokens);
}

export function recomputeRowCost(
  row: BillingLedgerCostRow,
  estimateCost: (
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheCreationInputTokens?: number,
    cacheReadInputTokens?: number,
  ) => number,
  cacheMode: ReconcileCacheMode,
): number {
  const cacheTokens = inferCacheTokensFromLedgerRow(row);
  if (cacheMode === "read") {
    return estimateCost(row.provider, row.model, row.inputTokens, row.outputTokens, 0, cacheTokens);
  }
  return estimateCost(row.provider, row.model, row.inputTokens, row.outputTokens, cacheTokens, 0);
}

