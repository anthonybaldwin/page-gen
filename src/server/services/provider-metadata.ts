/**
 * Extract Anthropic cache token counts from an AI SDK result or step object.
 *
 * The SDK exposes `providerMetadata.anthropic` but the field is untyped.
 * Both camelCase (AI SDK v4) and snake_case (raw Anthropic response) keys
 * are checked so callers don't need to handle the dual format themselves.
 */
export function extractAnthropicCacheTokens(
  resultOrStep: unknown,
): { cacheCreationInputTokens: number; cacheReadInputTokens: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (resultOrStep as any)?.providerMetadata?.anthropic;
  if (!meta || typeof meta !== "object") {
    return { cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  }
  return {
    cacheCreationInputTokens:
      Number(meta.cacheCreationInputTokens ?? meta.cache_creation_input_tokens) || 0,
    cacheReadInputTokens:
      Number(meta.cacheReadInputTokens ?? meta.cache_read_input_tokens) || 0,
  };
}
