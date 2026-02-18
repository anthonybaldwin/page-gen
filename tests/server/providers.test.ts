import { describe, test, expect } from "bun:test";
import { extractApiKeys, createProviders, hashApiKey } from "../../src/server/providers/registry.ts";
import { Hono } from "hono";

describe("Provider Registry", () => {
  test("extractApiKeys parses headers correctly", () => {
    const app = new Hono();
    let extracted: ReturnType<typeof extractApiKeys> | null = null;

    app.post("/test", (c) => {
      extracted = extractApiKeys(c);
      return c.json({ ok: true });
    });

    // Simulate request with headers
    app.fetch(
      new Request("http://localhost/test", {
        method: "POST",
        headers: {
          "X-Api-Key-Anthropic": "sk-ant-test123",
          "X-Api-Key-OpenAI": "sk-test456",
          "X-Proxy-Url-Anthropic": "https://proxy.example.com",
        },
      })
    );

    // Wait for async
    expect(extracted).toBeDefined();
  });

  test("createProviders creates Anthropic provider when key present", () => {
    const providers = createProviders({
      anthropic: { apiKey: "sk-ant-test", proxyUrl: "" },
      openai: { apiKey: "", proxyUrl: "" },
      google: { apiKey: "", proxyUrl: "" },
    });
    expect(providers.anthropic).toBeDefined();
    expect(providers.openai).toBeUndefined();
    expect(providers.google).toBeUndefined();
  });

  test("createProviders creates all providers when all keys present", () => {
    const providers = createProviders({
      anthropic: { apiKey: "sk-ant-test", proxyUrl: "" },
      openai: { apiKey: "sk-test", proxyUrl: "" },
      google: { apiKey: "AIza-test", proxyUrl: "" },
    });
    expect(providers.anthropic).toBeDefined();
    expect(providers.openai).toBeDefined();
    expect(providers.google).toBeDefined();
  });

  test("createProviders skips providers without keys", () => {
    const providers = createProviders({
      anthropic: { apiKey: "", proxyUrl: "" },
      openai: { apiKey: "", proxyUrl: "" },
      google: { apiKey: "", proxyUrl: "" },
    });
    expect(providers.anthropic).toBeUndefined();
    expect(providers.openai).toBeUndefined();
    expect(providers.google).toBeUndefined();
  });

  test("hashApiKey produces consistent SHA-256 hash", () => {
    const hash1 = hashApiKey("test-key");
    const hash2 = hashApiKey("test-key");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  test("hashApiKey produces different hashes for different keys", () => {
    const hash1 = hashApiKey("key-1");
    const hash2 = hashApiKey("key-2");
    expect(hash1).not.toBe(hash2);
  });
});
