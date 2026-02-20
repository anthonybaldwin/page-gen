export interface BillingLedgerCostRow {
  id: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costEstimate: number;
}

/**
 * Infer cache tokens from a legacy row that doesn't have explicit cache columns.
 * Returns 0 for rows where totalTokens == inputTokens + outputTokens.
 */
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
): number {
  // Use stored cache columns when available; fall back to inference for legacy rows
  const hasStoredCache = row.cacheCreationInputTokens > 0 || row.cacheReadInputTokens > 0;
  if (hasStoredCache) {
    return estimateCost(
      row.provider, row.model, row.inputTokens, row.outputTokens,
      row.cacheCreationInputTokens, row.cacheReadInputTokens,
    );
  }
  // Legacy: infer cache tokens and assume cache-creation (worst case)
  const inferred = inferCacheTokensFromLedgerRow(row);
  return estimateCost(row.provider, row.model, row.inputTokens, row.outputTokens, inferred, 0);
}
