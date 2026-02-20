import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";

/** Per-million-token pricing (USD) — verified Feb 2026, Anthropic Tier 2 */
export const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5-20251101": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "gpt-5.2": { input: 1.75, output: 14 },
  "gpt-5.2-pro": { input: 21, output: 168 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

export function isKnownModel(model: string): boolean {
  return model in DEFAULT_PRICING;
}

export function getKnownModelIds(): string[] {
  return Object.keys(DEFAULT_PRICING);
}

/** DB key helpers — model IDs may contain dots, so we use a prefix scheme. */
function pricingKey(model: string, field: "input" | "output"): string {
  return `pricing.${model}.${field}`;
}

function parsePricingKey(key: string): { model: string; field: "input" | "output" } | null {
  // key format: pricing.<model-id>.<input|output>
  // model-id may itself contain dots, so we split and take the last part as field
  if (!key.startsWith("pricing.")) return null;
  const rest = key.slice("pricing.".length); // e.g. "gpt-5.2.input"
  const lastDot = rest.lastIndexOf(".");
  if (lastDot === -1) return null;
  const field = rest.slice(lastDot + 1);
  if (field !== "input" && field !== "output") return null;
  const model = rest.slice(0, lastDot);
  return { model, field };
}

/** Read a pricing override from app_settings, or null if not set. */
function getOverride(model: string, field: "input" | "output"): number | null {
  const key = pricingKey(model, field);
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (!row) return null;
  const val = Number(row.value);
  return Number.isFinite(val) ? val : null;
}

export interface ModelPricingInfo {
  model: string;
  input: number;
  output: number;
  isOverridden: boolean;
  isKnown: boolean;
}

/**
 * Get effective pricing for a model.
 * Priority: DB override > DEFAULT_PRICING > null (unknown, unconfigured).
 */
export function getModelPricing(model: string): { input: number; output: number } | null {
  const overrideInput = getOverride(model, "input");
  const overrideOutput = getOverride(model, "output");
  if (overrideInput !== null && overrideOutput !== null) {
    return { input: overrideInput, output: overrideOutput };
  }
  if (isKnownModel(model)) {
    return DEFAULT_PRICING[model]!;
  }
  return null;
}

/**
 * Estimate cost in USD. Returns 0 for unknown models without pricing configured.
 * Cache tokens are charged at different rates:
 *   - cache_creation: 1.25x input price
 *   - cache_read: 0.1x input price
 *   - regular input: 1x input price
 * When cacheCreation/cacheRead are provided, inputTokens should be the NON-cached count.
 * When they're absent, inputTokens is treated as total input (backward compat).
 */
export function estimateCost(
  _provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  const inputCost = inputTokens * pricing.input;
  const outputCost = outputTokens * pricing.output;
  const cacheCreateCost = cacheCreationInputTokens * pricing.input * 1.25;
  const cacheReadCost = cacheReadInputTokens * pricing.input * 0.1;
  return (inputCost + outputCost + cacheCreateCost + cacheReadCost) / 1_000_000;
}

/** Upsert pricing override for a model in app_settings. */
export function upsertPricing(model: string, input: number, output: number): void {
  for (const [field, value] of [["input", input], ["output", output]] as const) {
    const key = pricingKey(model, field);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    const strVal = String(value);
    if (existing) {
      db.update(schema.appSettings).set({ value: strVal }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: strVal }).run();
    }
  }
}

/** Remove pricing override for a model (reverts to default if known). */
export function deletePricingOverride(model: string): void {
  for (const field of ["input", "output"] as const) {
    const key = pricingKey(model, field);
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
  }
}

/** Get all models with effective pricing, merging defaults + DB overrides. */
export function getAllPricing(): ModelPricingInfo[] {
  const result = new Map<string, ModelPricingInfo>();

  // Seed with known models
  for (const [model, pricing] of Object.entries(DEFAULT_PRICING)) {
    result.set(model, {
      model,
      input: pricing.input,
      output: pricing.output,
      isOverridden: false,
      isKnown: true,
    });
  }

  // Layer in DB overrides
  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, "pricing.%")).all();
  const overrides = new Map<string, { input?: number; output?: number }>();
  for (const row of rows) {
    const parsed = parsePricingKey(row.key);
    if (!parsed) continue;
    const existing = overrides.get(parsed.model) || {};
    existing[parsed.field] = Number(row.value);
    overrides.set(parsed.model, existing);
  }

  for (const [model, override] of overrides) {
    const known = result.get(model);
    if (known && override.input !== undefined && override.output !== undefined) {
      // Known model with override
      known.input = override.input;
      known.output = override.output;
      known.isOverridden = true;
    } else if (!known && override.input !== undefined && override.output !== undefined) {
      // Custom model with pricing
      result.set(model, {
        model,
        input: override.input,
        output: override.output,
        isOverridden: true,
        isKnown: false,
      });
    }
  }

  return Array.from(result.values());
}
