import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";
import type { CacheMultiplierInfo } from "../../shared/types.ts";
import { MODELS, CACHE_MULTIPLIERS, MODEL_MAP, type ModelCategory } from "../../shared/providers.ts";

/** Re-export for backward compat — derived from the shared MODELS array. */
export const PROVIDER_CACHE_MULTIPLIERS = CACHE_MULTIPLIERS;
const DEFAULT_CACHE_MULTIPLIERS = { create: 1.0, read: 0.5 };

/** Per-million-token pricing derived from the shared MODELS catalog. */
export const DEFAULT_PRICING: Record<string, { input: number; output: number }> = Object.fromEntries(
  MODELS.map((m) => [m.id, m.pricing]),
);

export function isKnownModel(model: string): boolean {
  return model in DEFAULT_PRICING;
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

/** DB key for cache multiplier overrides: cache.{provider}.{create|read} */
function cacheKey(provider: string, field: "create" | "read"): string {
  return `cache.${provider}.${field}`;
}

/** Read a cache multiplier override from app_settings, or null if not set. */
function getCacheOverride(provider: string, field: "create" | "read"): number | null {
  const key = cacheKey(provider, field);
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (!row) return null;
  const val = Number(row.value);
  return Number.isFinite(val) ? val : null;
}

/**
 * Get effective cache multipliers for a provider.
 * Priority: DB override > PROVIDER_CACHE_MULTIPLIERS > DEFAULT_CACHE_MULTIPLIERS.
 */
export function getCacheMultipliers(provider: string): { create: number; read: number } {
  const dbCreate = getCacheOverride(provider, "create");
  const dbRead = getCacheOverride(provider, "read");
  if (dbCreate !== null && dbRead !== null) {
    return { create: dbCreate, read: dbRead };
  }
  const known = PROVIDER_CACHE_MULTIPLIERS[provider];
  if (known) return known;
  return DEFAULT_CACHE_MULTIPLIERS;
}

export interface ModelPricingInfo {
  model: string;
  input: number;
  output: number;
  isOverridden: boolean;
  isKnown: boolean;
  provider?: string;
  category?: ModelCategory;
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
 * Cache tokens are charged at provider-specific rates (see PROVIDER_CACHE_MULTIPLIERS).
 * When cacheCreation/cacheRead are provided, inputTokens should be the NON-cached count.
 * When they're absent, inputTokens is treated as total input (backward compat).
 */
export function estimateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens = 0,
  cacheReadInputTokens = 0,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;
  const cache = getCacheMultipliers(provider);
  const inputCost = inputTokens * pricing.input;
  const outputCost = outputTokens * pricing.output;
  const cacheCreateCost = cacheCreationInputTokens * pricing.input * cache.create;
  const cacheReadCost = cacheReadInputTokens * pricing.input * cache.read;
  return (inputCost + outputCost + cacheCreateCost + cacheReadCost) / 1_000_000;
}

/** Upsert pricing override for a model in app_settings. Optional provider for custom models. */
export function upsertPricing(model: string, input: number, output: number, provider?: string): void {
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
  if (provider) {
    const key = `pricing.${model}.provider`;
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    if (existing) {
      db.update(schema.appSettings).set({ value: provider }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: provider }).run();
    }
  }
}

/** Remove pricing override for a model (reverts to default if known). */
export function deletePricingOverride(model: string): void {
  for (const field of ["input", "output"] as const) {
    const key = pricingKey(model, field);
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
  }
  // Also clean up provider and category keys for custom models
  const providerKey = `pricing.${model}.provider`;
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, providerKey)).run();
  const categoryKey = `model.${model}.category`;
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, categoryKey)).run();
}

/** Upsert a category override for a custom model in app_settings. */
export function upsertModelCategory(model: string, category: ModelCategory): void {
  const key = `model.${model}.category`;
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value: category }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value: category }).run();
  }
}

/** Get the effective category for a model: catalog → DB → "text". */
export function getModelCategoryFromDB(model: string): ModelCategory {
  // Check catalog first
  const catalogModel = MODEL_MAP[model];
  if (catalogModel) return catalogModel.category ?? "text";
  // Check DB override
  const key = `model.${model}.category`;
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (row?.value) return row.value as ModelCategory;
  return "text";
}

/** Get all models with effective pricing, merging defaults + DB overrides. */
export function getAllPricing(): ModelPricingInfo[] {
  const result = new Map<string, ModelPricingInfo>();

  // Seed with known models (include catalog category)
  for (const [model, pricing] of Object.entries(DEFAULT_PRICING)) {
    const catalogModel = MODEL_MAP[model];
    result.set(model, {
      model,
      input: pricing.input,
      output: pricing.output,
      isOverridden: false,
      isKnown: true,
      category: catalogModel?.category ?? "text",
    });
  }

  // Layer in DB overrides
  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, "pricing.%")).all();
  const overrides = new Map<string, { input?: number; output?: number }>();
  const providerMap = new Map<string, string>();
  for (const row of rows) {
    // Check for provider keys: pricing.<model>.provider
    if (row.key.endsWith(".provider")) {
      const model = row.key.slice("pricing.".length, row.key.length - ".provider".length);
      if (model) providerMap.set(model, row.value);
      continue;
    }
    const parsed = parsePricingKey(row.key);
    if (!parsed) continue;
    const existing = overrides.get(parsed.model) || {};
    existing[parsed.field] = Number(row.value);
    overrides.set(parsed.model, existing);
  }

  // Build category map for custom models from DB
  const categoryRows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, "model.%")).all();
  const categoryMap = new Map<string, ModelCategory>();
  for (const row of categoryRows) {
    if (row.key.endsWith(".category")) {
      const model = row.key.slice("model.".length, row.key.length - ".category".length);
      if (model) categoryMap.set(model, row.value as ModelCategory);
    }
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
        provider: providerMap.get(model),
        category: categoryMap.get(model) ?? "text",
      });
    }
  }

  return Array.from(result.values());
}

/** Get all providers with effective cache multipliers, merging defaults + DB overrides. */
export function getAllCacheMultipliers(): CacheMultiplierInfo[] {
  const result = new Map<string, CacheMultiplierInfo>();

  for (const [provider, multipliers] of Object.entries(PROVIDER_CACHE_MULTIPLIERS)) {
    result.set(provider, {
      provider,
      create: multipliers.create,
      read: multipliers.read,
      isOverridden: false,
      isKnown: true,
    });
  }

  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, "cache.%")).all();
  const overrides = new Map<string, { create?: number; read?: number }>();
  for (const row of rows) {
    if (!row.key.startsWith("cache.")) continue;
    const rest = row.key.slice("cache.".length);
    const lastDot = rest.lastIndexOf(".");
    if (lastDot === -1) continue;
    const field = rest.slice(lastDot + 1);
    if (field !== "create" && field !== "read") continue;
    const provider = rest.slice(0, lastDot);
    const existing = overrides.get(provider) || {};
    existing[field] = Number(row.value);
    overrides.set(provider, existing);
  }

  for (const [provider, override] of overrides) {
    const known = result.get(provider);
    if (known && override.create !== undefined && override.read !== undefined) {
      known.create = override.create;
      known.read = override.read;
      known.isOverridden = true;
    } else if (!known && override.create !== undefined && override.read !== undefined) {
      result.set(provider, {
        provider,
        create: override.create,
        read: override.read,
        isOverridden: true,
        isKnown: false,
      });
    }
  }

  return Array.from(result.values());
}

/** Upsert cache multiplier overrides for a provider. */
export function upsertCacheMultipliers(provider: string, create: number, read: number): void {
  for (const [field, value] of [["create", create], ["read", read]] as const) {
    const key = cacheKey(provider, field);
    const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
    const strVal = String(value);
    if (existing) {
      db.update(schema.appSettings).set({ value: strVal }).where(eq(schema.appSettings.key, key)).run();
    } else {
      db.insert(schema.appSettings).values({ key, value: strVal }).run();
    }
  }
}

/** Remove cache multiplier overrides for a provider (reverts to default if known). */
export function deleteCacheMultiplierOverride(provider: string): void {
  for (const field of ["create", "read"] as const) {
    const key = cacheKey(provider, field);
    db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
  }
}
