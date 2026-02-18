import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Context } from "hono";

export interface ProviderInstance {
  anthropic?: ReturnType<typeof createAnthropic>;
  openai?: ReturnType<typeof createOpenAI>;
  google?: ReturnType<typeof createGoogleGenerativeAI>;
}

export function extractApiKeys(c: Context) {
  return {
    anthropic: {
      apiKey: c.req.header("X-Api-Key-Anthropic") || "",
      proxyUrl: c.req.header("X-Proxy-Url-Anthropic") || "",
    },
    openai: {
      apiKey: c.req.header("X-Api-Key-OpenAI") || "",
      proxyUrl: c.req.header("X-Proxy-Url-OpenAI") || "",
    },
    google: {
      apiKey: c.req.header("X-Api-Key-Google") || "",
      proxyUrl: c.req.header("X-Proxy-Url-Google") || "",
    },
  };
}

export function createProviders(keys: ReturnType<typeof extractApiKeys>): ProviderInstance {
  const providers: ProviderInstance = {};

  if (keys.anthropic.apiKey) {
    providers.anthropic = createAnthropic({
      apiKey: keys.anthropic.apiKey,
      ...(keys.anthropic.proxyUrl ? { baseURL: keys.anthropic.proxyUrl } : {}),
    });
  }

  if (keys.openai.apiKey) {
    providers.openai = createOpenAI({
      apiKey: keys.openai.apiKey,
      ...(keys.openai.proxyUrl ? { baseURL: keys.openai.proxyUrl } : {}),
    });
  }

  if (keys.google.apiKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: keys.google.apiKey,
      ...(keys.google.proxyUrl ? { baseURL: keys.google.proxyUrl } : {}),
    });
  }

  return providers;
}

export function hashApiKey(key: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(key);
  return hasher.digest("hex");
}
