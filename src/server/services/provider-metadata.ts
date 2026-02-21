/**
 * Extract cache token counts from an AI SDK result or step object.
 *
 * AI SDK v6 provides cache details in two places:
 *   1. `usage.inputTokenDetails` (preferred — works for all providers)
 *   2. `providerMetadata.anthropic` (legacy — only has cacheCreationInputTokens,
 *      cacheReadInputTokens was removed in @ai-sdk/anthropic v3)
 *
 * We check (1) first, then fall back to (2) + the raw usage object inside
 * providerMetadata for backward compat.
 */
export function extractAnthropicCacheTokens(
  resultOrStep: unknown,
): { cacheCreationInputTokens: number; cacheReadInputTokens: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = resultOrStep as any;

  // Preferred path: AI SDK v6 inputTokenDetails (works for all providers)
  const details = obj?.usage?.inputTokenDetails;
  if (details && typeof details === "object") {
    return {
      cacheCreationInputTokens: Number(details.cacheWriteTokens) || 0,
      cacheReadInputTokens: Number(details.cacheReadTokens) || 0,
    };
  }

  // Fallback: providerMetadata.anthropic (legacy)
  const meta = obj?.providerMetadata?.anthropic;
  if (!meta || typeof meta !== "object") {
    return { cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  }

  // cacheCreationInputTokens lives on the metadata root;
  // cacheReadInputTokens was removed — dig into the raw usage object.
  const rawUsage = meta.usage;
  return {
    cacheCreationInputTokens:
      Number(meta.cacheCreationInputTokens ?? meta.cache_creation_input_tokens) || 0,
    cacheReadInputTokens:
      Number(meta.cacheReadInputTokens
        ?? meta.cache_read_input_tokens
        ?? rawUsage?.cache_read_input_tokens) || 0,
  };
}
