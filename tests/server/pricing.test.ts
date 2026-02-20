import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import {
  DEFAULT_PRICING,
  PROVIDER_CACHE_MULTIPLIERS,
  isKnownModel,
  getKnownModelIds,
  getModelPricing,
  estimateCost,
  getCacheMultipliers,
  upsertPricing,
  deletePricingOverride,
  getAllPricing,
  getAllCacheMultipliers,
  upsertCacheMultipliers,
  deleteCacheMultiplierOverride,
} from "../../src/server/services/pricing.ts";

describe("Pricing Module", () => {
  beforeAll(() => {
    runMigrations();
  });

  test("DEFAULT_PRICING has all 8 known models", () => {
    const ids = Object.keys(DEFAULT_PRICING);
    expect(ids).toHaveLength(8);
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-opus-4-5-20251101");
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-sonnet-4-5-20250929");
    expect(ids).toContain("claude-haiku-4-5-20251001");
    expect(ids).toContain("gpt-5.2");
    expect(ids).toContain("gpt-5.2-pro");
    expect(ids).toContain("gemini-2.5-flash");
  });

  test("isKnownModel returns true for known models", () => {
    expect(isKnownModel("claude-opus-4-6")).toBe(true);
    expect(isKnownModel("gpt-5.2")).toBe(true);
    expect(isKnownModel("gemini-2.5-flash")).toBe(true);
  });

  test("isKnownModel returns false for unknown models", () => {
    expect(isKnownModel("my-custom-model")).toBe(false);
    expect(isKnownModel("gpt-6")).toBe(false);
  });

  test("getKnownModelIds returns all 8 model IDs", () => {
    const ids = getKnownModelIds();
    expect(ids).toHaveLength(8);
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("gemini-2.5-flash");
  });

  test("getModelPricing returns correct pricing for known models", () => {
    const opus = getModelPricing("claude-opus-4-6");
    expect(opus).toEqual({ input: 5, output: 25 });

    const flash = getModelPricing("gemini-2.5-flash");
    expect(flash).toEqual({ input: 0.3, output: 2.5 });
  });

  test("getModelPricing returns null for unknown models without override", () => {
    const result = getModelPricing("unknown-model-xyz");
    expect(result).toBeNull();
  });

  test("estimateCost calculates correctly for known models", () => {
    // Opus: $5/M input + $25/M output
    const cost = estimateCost("anthropic", "claude-opus-4-6", 1000, 500);
    // (1000 * 5 + 500 * 25) / 1_000_000 = 0.0175
    expect(cost).toBeCloseTo(0.0175, 4);
  });

  test("estimateCost includes Anthropic cache token pricing (1.25x create, 0.1x read)", () => {
    // Opus: $5/M input, $25/M output
    // 1000 non-cached input, 500 output, 2000 cache creation (1.25x), 3000 cache read (0.1x)
    const cost = estimateCost("anthropic", "claude-opus-4-6", 1000, 500, 2000, 3000);
    // inputCost = 1000 * 5 = 5000
    // outputCost = 500 * 25 = 12500
    // cacheCreateCost = 2000 * 5 * 1.25 = 12500
    // cacheReadCost = 3000 * 5 * 0.1 = 1500
    // total = (5000 + 12500 + 12500 + 1500) / 1_000_000 = 0.0315
    expect(cost).toBeCloseTo(0.0315, 4);
  });

  test("estimateCost uses OpenAI cache multipliers (0x create, 0.5x read)", () => {
    // gpt-5.2: $1.75/M input, $14/M output
    // 1000 input, 500 output, 2000 cache creation (0x), 3000 cache read (0.5x)
    const cost = estimateCost("openai", "gpt-5.2", 1000, 500, 2000, 3000);
    // inputCost = 1000 * 1.75 = 1750
    // outputCost = 500 * 14 = 7000
    // cacheCreateCost = 2000 * 1.75 * 0 = 0
    // cacheReadCost = 3000 * 1.75 * 0.5 = 2625
    // total = (1750 + 7000 + 0 + 2625) / 1_000_000 = 0.011375
    expect(cost).toBeCloseTo(0.011375, 6);
  });

  test("estimateCost uses Google cache multipliers (0x create, 0.25x read)", () => {
    // gemini-2.5-flash: $0.3/M input, $2.5/M output
    // 1000 input, 500 output, 2000 cache creation (0x), 3000 cache read (0.25x)
    const cost = estimateCost("google", "gemini-2.5-flash", 1000, 500, 2000, 3000);
    // inputCost = 1000 * 0.3 = 300
    // outputCost = 500 * 2.5 = 1250
    // cacheCreateCost = 2000 * 0.3 * 0 = 0
    // cacheReadCost = 3000 * 0.3 * 0.25 = 225
    // total = (300 + 1250 + 0 + 225) / 1_000_000 = 0.001775
    expect(cost).toBeCloseTo(0.001775, 6);
  });

  test("estimateCost uses default multipliers for unknown providers", () => {
    // default: 1.0x create, 0.5x read
    // Opus: $5/M input, $25/M output
    const cost = estimateCost("some-new-provider", "claude-opus-4-6", 1000, 500, 2000, 3000);
    // inputCost = 1000 * 5 = 5000
    // outputCost = 500 * 25 = 12500
    // cacheCreateCost = 2000 * 5 * 1.0 = 10000
    // cacheReadCost = 3000 * 5 * 0.5 = 7500
    // total = (5000 + 12500 + 10000 + 7500) / 1_000_000 = 0.035
    expect(cost).toBeCloseTo(0.035, 4);
  });

  test("estimateCost without cache tokens is backward compatible", () => {
    // Without cache params, should work the same as before
    const cost = estimateCost("anthropic", "claude-opus-4-6", 1000, 500);
    expect(cost).toBeCloseTo(0.0175, 4);
  });

  test("estimateCost returns 0 for unknown models", () => {
    const cost = estimateCost("custom", "unknown-model", 1000, 500);
    expect(cost).toBe(0);
  });

  test("upsertPricing creates override, getModelPricing reads it", () => {
    upsertPricing("my-custom-llm", 2, 10);
    const pricing = getModelPricing("my-custom-llm");
    expect(pricing).toEqual({ input: 2, output: 10 });
  });

  test("estimateCost uses override for custom model", () => {
    upsertPricing("my-priced-model", 4, 20);
    const cost = estimateCost("custom", "my-priced-model", 1_000_000, 1_000_000);
    // (1M * 4 + 1M * 20) / 1M = 24
    expect(cost).toBeCloseTo(24, 2);
  });

  test("upsertPricing overrides known model pricing", () => {
    upsertPricing("claude-opus-4-6", 10, 50);
    const pricing = getModelPricing("claude-opus-4-6");
    expect(pricing).toEqual({ input: 10, output: 50 });
  });

  test("deletePricingOverride reverts known model to default", () => {
    deletePricingOverride("claude-opus-4-6");
    const pricing = getModelPricing("claude-opus-4-6");
    expect(pricing).toEqual({ input: 5, output: 25 });
  });

  test("deletePricingOverride makes unknown model return null", () => {
    upsertPricing("temp-model", 1, 5);
    expect(getModelPricing("temp-model")).toEqual({ input: 1, output: 5 });
    deletePricingOverride("temp-model");
    expect(getModelPricing("temp-model")).toBeNull();
  });

  test("getAllPricing returns known models with flags", () => {
    const all = getAllPricing();
    const opus = all.find((p) => p.model === "claude-opus-4-6");
    expect(opus).toBeDefined();
    expect(opus!.isKnown).toBe(true);
    expect(opus!.isOverridden).toBe(false);
    expect(opus!.input).toBe(5);
    expect(opus!.output).toBe(25);
  });

  test("getAllPricing includes custom models with overrides", () => {
    upsertPricing("custom-for-all", 3, 12);
    const all = getAllPricing();
    const custom = all.find((p) => p.model === "custom-for-all");
    expect(custom).toBeDefined();
    expect(custom!.isKnown).toBe(false);
    expect(custom!.isOverridden).toBe(true);
    expect(custom!.input).toBe(3);
    expect(custom!.output).toBe(12);
    deletePricingOverride("custom-for-all");
  });

  test("getAllPricing marks overridden known models", () => {
    upsertPricing("gemini-2.5-flash", 0.5, 5);
    const all = getAllPricing();
    const flash = all.find((p) => p.model === "gemini-2.5-flash");
    expect(flash).toBeDefined();
    expect(flash!.isKnown).toBe(true);
    expect(flash!.isOverridden).toBe(true);
    expect(flash!.input).toBe(0.5);
    expect(flash!.output).toBe(5);
    deletePricingOverride("gemini-2.5-flash");
  });

  test("handles model IDs with dots correctly", () => {
    upsertPricing("gpt-5.2", 2, 16);
    const pricing = getModelPricing("gpt-5.2");
    expect(pricing).toEqual({ input: 2, output: 16 });
    deletePricingOverride("gpt-5.2");
    // Should revert to default
    expect(getModelPricing("gpt-5.2")).toEqual({ input: 1.75, output: 14 });
  });

  // --- Cache multiplier tests ---

  test("PROVIDER_CACHE_MULTIPLIERS has entries for anthropic, openai, google", () => {
    expect(PROVIDER_CACHE_MULTIPLIERS.anthropic).toEqual({ create: 1.25, read: 0.1 });
    expect(PROVIDER_CACHE_MULTIPLIERS.openai).toEqual({ create: 0, read: 0.5 });
    expect(PROVIDER_CACHE_MULTIPLIERS.google).toEqual({ create: 0, read: 0.25 });
  });

  test("getCacheMultipliers returns known provider multipliers", () => {
    expect(getCacheMultipliers("anthropic")).toEqual({ create: 1.25, read: 0.1 });
    expect(getCacheMultipliers("openai")).toEqual({ create: 0, read: 0.5 });
    expect(getCacheMultipliers("google")).toEqual({ create: 0, read: 0.25 });
  });

  test("getCacheMultipliers returns defaults for unknown providers", () => {
    expect(getCacheMultipliers("unknown-provider")).toEqual({ create: 1.0, read: 0.5 });
  });

  test("upsertCacheMultipliers overrides known provider", () => {
    upsertCacheMultipliers("anthropic", 1.5, 0.2);
    expect(getCacheMultipliers("anthropic")).toEqual({ create: 1.5, read: 0.2 });
    deleteCacheMultiplierOverride("anthropic");
    expect(getCacheMultipliers("anthropic")).toEqual({ create: 1.25, read: 0.1 });
  });

  test("upsertCacheMultipliers creates custom provider", () => {
    upsertCacheMultipliers("my-provider", 0.8, 0.3);
    expect(getCacheMultipliers("my-provider")).toEqual({ create: 0.8, read: 0.3 });
    deleteCacheMultiplierOverride("my-provider");
    expect(getCacheMultipliers("my-provider")).toEqual({ create: 1.0, read: 0.5 });
  });

  test("estimateCost respects DB cache multiplier overrides", () => {
    upsertCacheMultipliers("anthropic", 2.0, 0.5);
    // Opus: $5/M input, $25/M output
    const cost = estimateCost("anthropic", "claude-opus-4-6", 1000, 500, 2000, 3000);
    // inputCost = 1000 * 5 = 5000
    // outputCost = 500 * 25 = 12500
    // cacheCreateCost = 2000 * 5 * 2.0 = 20000
    // cacheReadCost = 3000 * 5 * 0.5 = 7500
    // total = (5000 + 12500 + 20000 + 7500) / 1_000_000 = 0.045
    expect(cost).toBeCloseTo(0.045, 4);
    deleteCacheMultiplierOverride("anthropic");
  });

  test("getAllCacheMultipliers returns known providers", () => {
    const all = getAllCacheMultipliers();
    const anthropic = all.find((c) => c.provider === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic!.isKnown).toBe(true);
    expect(anthropic!.isOverridden).toBe(false);
    expect(anthropic!.create).toBe(1.25);
    expect(anthropic!.read).toBe(0.1);
  });

  test("getAllCacheMultipliers includes custom providers with overrides", () => {
    upsertCacheMultipliers("custom-prov", 0.5, 0.1);
    const all = getAllCacheMultipliers();
    const custom = all.find((c) => c.provider === "custom-prov");
    expect(custom).toBeDefined();
    expect(custom!.isKnown).toBe(false);
    expect(custom!.isOverridden).toBe(true);
    expect(custom!.create).toBe(0.5);
    expect(custom!.read).toBe(0.1);
    deleteCacheMultiplierOverride("custom-prov");
  });

  test("getAllCacheMultipliers marks overridden known providers", () => {
    upsertCacheMultipliers("openai", 0.1, 0.6);
    const all = getAllCacheMultipliers();
    const openai = all.find((c) => c.provider === "openai");
    expect(openai).toBeDefined();
    expect(openai!.isKnown).toBe(true);
    expect(openai!.isOverridden).toBe(true);
    expect(openai!.create).toBe(0.1);
    expect(openai!.read).toBe(0.6);
    deleteCacheMultiplierOverride("openai");
  });
});

// --- Billing dedup: verify non-cached inputTokens produces correct cost ---

describe("Billing dedup: SDK inputTokens includes cache tokens", () => {
  test("Anthropic: deduped cost is lower than double-counted cost", () => {
    // Simulated SDK response: inputTokens=5000 (includes 1000 cache_create + 2000 cache_read)
    // Non-cached input = 5000 - 1000 - 2000 = 2000
    const rawSdkInputTokens = 5000;
    const cacheCreate = 1000;
    const cacheRead = 2000;
    const outputTokens = 500;

    // Double-counted cost (old bug): charges rawSdkInputTokens as non-cached + cache separately
    const buggedCost = estimateCost("anthropic", "claude-opus-4-6", rawSdkInputTokens, outputTokens, cacheCreate, cacheRead);
    // Correct cost: subtract cache from SDK value first
    const nonCachedInput = rawSdkInputTokens - cacheCreate - cacheRead;
    const correctCost = estimateCost("anthropic", "claude-opus-4-6", nonCachedInput, outputTokens, cacheCreate, cacheRead);

    // Correct should be less than bugged
    expect(correctCost).toBeLessThan(buggedCost);

    // Verify exact values:
    // Opus: $5/M input, $25/M output, Anthropic cache: 1.25x create, 0.1x read
    // Correct: (2000*5 + 500*25 + 1000*5*1.25 + 2000*5*0.1) / 1M
    //        = (10000 + 12500 + 6250 + 1000) / 1M = 0.02975
    expect(correctCost).toBeCloseTo(0.02975, 5);

    // Bugged: (5000*5 + 500*25 + 1000*5*1.25 + 2000*5*0.1) / 1M
    //       = (25000 + 12500 + 6250 + 1000) / 1M = 0.04475
    expect(buggedCost).toBeCloseTo(0.04475, 5);
  });

  test("OpenAI: deduped cost is lower than double-counted cost", () => {
    // OpenAI cache: 0x create, 0.5x read
    const rawSdkInputTokens = 5000;
    const cacheCreate = 1000;
    const cacheRead = 2000;
    const outputTokens = 500;

    const buggedCost = estimateCost("openai", "gpt-5.2", rawSdkInputTokens, outputTokens, cacheCreate, cacheRead);
    const nonCachedInput = rawSdkInputTokens - cacheCreate - cacheRead;
    const correctCost = estimateCost("openai", "gpt-5.2", nonCachedInput, outputTokens, cacheCreate, cacheRead);

    expect(correctCost).toBeLessThan(buggedCost);
  });

  test("Google: deduped cost is lower than double-counted cost", () => {
    // Google cache: 0x create, 0.25x read
    const rawSdkInputTokens = 5000;
    const cacheCreate = 1000;
    const cacheRead = 2000;
    const outputTokens = 500;

    const buggedCost = estimateCost("google", "gemini-2.5-flash", rawSdkInputTokens, outputTokens, cacheCreate, cacheRead);
    const nonCachedInput = rawSdkInputTokens - cacheCreate - cacheRead;
    const correctCost = estimateCost("google", "gemini-2.5-flash", nonCachedInput, outputTokens, cacheCreate, cacheRead);

    expect(correctCost).toBeLessThan(buggedCost);
  });

  test("no cache tokens: deduped and non-deduped are identical", () => {
    const cost1 = estimateCost("anthropic", "claude-opus-4-6", 1000, 500, 0, 0);
    const cost2 = estimateCost("anthropic", "claude-opus-4-6", 1000, 500);
    expect(cost1).toBeCloseTo(cost2, 10);
  });
});
