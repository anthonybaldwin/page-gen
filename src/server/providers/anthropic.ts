import { createAnthropic } from "@ai-sdk/anthropic";

export function createAnthropicProvider(apiKey: string, baseURL?: string) {
  return createAnthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

export const ANTHROPIC_MODELS = {
  "opus-4-6": "claude-opus-4-6",
  "opus-4-5": "claude-opus-4-5-20251101",
  "sonnet-4-6": "claude-sonnet-4-6",
  "sonnet-4-5": "claude-sonnet-4-5-20250929",
  "haiku-4-5": "claude-haiku-4-5-20251001",
} as const;
