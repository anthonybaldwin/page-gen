import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Context } from "hono";
import { log, logWarn } from "../services/logger.ts";

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

/** Redact API keys from URLs (e.g., Google AI uses ?key=... query params). */
function redactUrlKeys(url: string): string {
  return url.replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
}

/** Wrap fetch to log every LLM request and response (status, headers, timing). */
function createLoggingFetch(provider: string): typeof globalThis.fetch {
  // Cast: Bun's fetch type includes a static `preconnect` property we don't need
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const url = redactUrlKeys(rawUrl);
    const method = init?.method || "POST";
    const start = Date.now();

    // Log request body summary (model + message count, not full content)
    const requestData: Record<string, unknown> = { method, url, provider };
    if (init?.body) {
      try {
        const bodyStr = typeof init.body === "string" ? init.body : "";
        if (bodyStr) {
          const parsed = JSON.parse(bodyStr);
          requestData.model = parsed.model || "?";
          requestData.messages = parsed.messages?.length || 0;
          requestData.maxTokens = parsed.max_tokens || "?";
          if (parsed.stream) requestData.stream = true;
        }
      } catch { /* not JSON or not parseable */ }
    }

    log("llm-http", `→ ${method} ${provider}`, requestData);

    // Fix malformed tool_use.input (AI SDK bug — stringifies instead of object)
    if (init?.body && typeof init.body === "string") {
      try {
        const parsed = JSON.parse(init.body);
        if (parsed.messages) {
          let modified = false;
          for (const msg of parsed.messages) {
            if (Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === "tool_use" && typeof block.input === "string") {
                  try {
                    block.input = JSON.parse(block.input);
                  } catch {
                    // Input is malformed JSON (model hit output token limit mid-string).
                    // Log clearly and let the 400 happen — retrying won't help.
                    logWarn("llm-http", `${provider} tool_use.input is invalid JSON — model likely hit output token limit`, {
                      provider, tool: block.name || "?", inputChars: block.input.length,
                    });
                    block.input = {};
                  }
                  modified = true;
                }
              }
            }
          }
          if (modified) {
            log("llm-http", `Fixed ${provider} request: parsed stringified tool_use.input back to object`, { provider });
            init = { ...init, body: JSON.stringify(parsed) };
          }
        }
      } catch { /* not fixable — send as-is */ }
    }

    const response = await globalThis.fetch(input, init);
    const elapsed = Date.now() - start;

    // Extract useful response headers
    const requestId = response.headers.get("request-id") || response.headers.get("x-request-id") || "";
    const retryAfter = response.headers.get("retry-after") || "";
    const rateLimitRemaining = response.headers.get("anthropic-ratelimit-requests-remaining")
      || response.headers.get("x-ratelimit-remaining-requests") || "";
    const rateLimitTokensRemaining = response.headers.get("anthropic-ratelimit-tokens-remaining")
      || response.headers.get("x-ratelimit-remaining-tokens") || "";

    const responseData: Record<string, unknown> = {
      status: response.status, provider, elapsed,
      ...(requestId ? { requestId } : {}),
      ...(retryAfter ? { retryAfter } : {}),
      ...(rateLimitRemaining ? { reqRemaining: rateLimitRemaining } : {}),
      ...(rateLimitTokensRemaining ? { tokRemaining: rateLimitTokensRemaining } : {}),
    };

    if (response.ok) {
      log("llm-http", `← ${response.status} ${provider} ${elapsed}ms`, responseData);
    } else {
      // For error responses, try to read the body for the error message
      // Clone so the SDK can still read it
      const cloned = response.clone();
      try {
        const errorBody = await cloned.text();
        responseData.body = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
      } catch { /* stream not readable */ }
      logWarn("llm-http", `← ${response.status} ${provider} ${elapsed}ms`, responseData);
    }

    return response;
  }) as typeof globalThis.fetch;
}

export function createProviders(keys: ReturnType<typeof extractApiKeys>): ProviderInstance {
  const providers: ProviderInstance = {};

  if (keys.anthropic.apiKey) {
    providers.anthropic = createAnthropic({
      apiKey: keys.anthropic.apiKey,
      ...(keys.anthropic.proxyUrl ? { baseURL: keys.anthropic.proxyUrl } : {}),
      fetch: createLoggingFetch("anthropic"),
    });
  }

  if (keys.openai.apiKey) {
    providers.openai = createOpenAI({
      apiKey: keys.openai.apiKey,
      ...(keys.openai.proxyUrl ? { baseURL: keys.openai.proxyUrl } : {}),
      fetch: createLoggingFetch("openai"),
    });
  }

  if (keys.google.apiKey) {
    providers.google = createGoogleGenerativeAI({
      apiKey: keys.google.apiKey,
      ...(keys.google.proxyUrl ? { baseURL: keys.google.proxyUrl } : {}),
      fetch: createLoggingFetch("google"),
    });
  }

  return providers;
}

export function hashApiKey(key: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(key);
  return hasher.digest("hex");
}
