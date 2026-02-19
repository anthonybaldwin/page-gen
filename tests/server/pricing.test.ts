import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import {
  DEFAULT_PRICING,
  isKnownModel,
  getKnownModelIds,
  getModelPricing,
  estimateCost,
  upsertPricing,
  deletePricingOverride,
  getAllPricing,
} from "../../src/server/services/pricing.ts";

describe("Pricing Module", () => {
  beforeAll(() => {
    runMigrations();
  });

  test("DEFAULT_PRICING has all 6 known models", () => {
    const ids = Object.keys(DEFAULT_PRICING);
    expect(ids).toHaveLength(6);
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-sonnet-4-6");
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

  test("getKnownModelIds returns all 6 model IDs", () => {
    const ids = getKnownModelIds();
    expect(ids).toHaveLength(6);
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
});
