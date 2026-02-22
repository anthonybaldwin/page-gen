/**
 * Centralized provider & model configuration.
 * Single source of truth imported by both client and server.
 *
 * Adding a new provider:
 *  1. Add an entry to PROVIDERS, MODELS, CACHE_MULTIPLIERS, VALIDATION_MODELS here
 *  2. Add 1 line to SDK_FACTORIES in src/server/providers/registry.ts + npm install
 */

// ---------------------------------------------------------------------------
// Provider definitions
// ---------------------------------------------------------------------------

export interface ProviderDef {
  id: string;
  label: string;
  /** Suffix used for X-Api-Key-{headerKey} and X-Proxy-Url-{headerKey} headers */
  headerKey: string;
  placeholder: string;
  proxyPlaceholder: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    headerKey: "Anthropic",
    placeholder: "sk-ant-...",
    proxyPlaceholder: "https://api.anthropic.com",
  },
  {
    id: "openai",
    label: "OpenAI",
    headerKey: "OpenAI",
    placeholder: "sk-...",
    proxyPlaceholder: "https://api.openai.com",
  },
  {
    id: "google",
    label: "Google AI",
    headerKey: "Google",
    placeholder: "AIza...",
    proxyPlaceholder: "https://generativelanguage.googleapis.com",
  },
];

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

export interface ModelDef {
  id: string;
  provider: string;
  pricing: { input: number; output: number };
}

/** Per-million-token pricing (USD) — verified Feb 2026, Anthropic Tier 2 */
export const MODELS: ModelDef[] = [
  // Anthropic
  { id: "claude-opus-4-6",             provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-opus-4-5-20251101",    provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-sonnet-4-6",           provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-sonnet-4-5-20250929",  provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-haiku-4-5-20251001",   provider: "anthropic", pricing: { input: 1,    output: 5 } },
  // OpenAI
  { id: "gpt-5.2",                     provider: "openai",    pricing: { input: 1.75, output: 14 } },
  { id: "gpt-5.2-pro",                 provider: "openai",    pricing: { input: 21,   output: 168 } },
  // Google
  { id: "gemini-2.5-flash",            provider: "google",    pricing: { input: 0.3,  output: 2.5 } },
];

// ---------------------------------------------------------------------------
// Cache multipliers (relative to input price)
// ---------------------------------------------------------------------------

export const CACHE_MULTIPLIERS: Record<string, { create: number; read: number }> = {
  anthropic: { create: 1.25, read: 0.1 },
  openai:    { create: 0,    read: 0.5 },
  google:    { create: 0,    read: 0.25 },
};

// ---------------------------------------------------------------------------
// Validation models — cheapest model per provider, used for key validation
// ---------------------------------------------------------------------------

export const VALIDATION_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai:    "gpt-5.2",
  google:    "gemini-2.5-flash",
};

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

/** All provider IDs: ["anthropic", "openai", "google"] */
export const PROVIDER_IDS: string[] = PROVIDERS.map((p) => p.id);

/** Quick lookup: providerId → ProviderDef */
export const PROVIDER_MAP: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
);

/** Quick lookup: modelId → ModelDef */
export const MODEL_MAP: Record<string, ModelDef> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
);

/** Get all model defs for a given provider. */
export function getModelsForProvider(providerId: string): ModelDef[] {
  return MODELS.filter((m) => m.provider === providerId);
}

/** Get default pricing for a model, or null if unknown. */
export function getDefaultPricing(modelId: string): { input: number; output: number } | null {
  return MODEL_MAP[modelId]?.pricing ?? null;
}

/** Get the provider id for a known model, or undefined if unknown. */
export function getModelProvider(modelId: string): string | undefined {
  return MODEL_MAP[modelId]?.provider;
}
