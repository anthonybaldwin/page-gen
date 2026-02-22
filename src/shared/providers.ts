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
  {
    id: "xai",
    label: "xAI (Grok)",
    headerKey: "XAI",
    placeholder: "xai-...",
    proxyPlaceholder: "https://api.x.ai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    headerKey: "DeepSeek",
    placeholder: "sk-...",
    proxyPlaceholder: "https://api.deepseek.com",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    headerKey: "Mistral",
    placeholder: "...",
    proxyPlaceholder: "https://api.mistral.ai",
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

/**
 * Per-million-token pricing (USD) — verified Feb 2026.
 *
 * Pricing sources:
 *   Anthropic — platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI    — platform.openai.com/docs/pricing
 *   Google    — ai.google.dev/pricing
 *   xAI       — docs.x.ai/developers/models
 *   DeepSeek  — api-docs.deepseek.com/quick_start/pricing
 *   Mistral   — docs.mistral.ai/getting-started/models
 */
export const MODELS: ModelDef[] = [
  // -------------------------------------------------------------------------
  // Anthropic
  // -------------------------------------------------------------------------
  { id: "claude-opus-4-6",             provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-opus-4-5-20251101",    provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-sonnet-4-6",           provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-sonnet-4-5-20250929",  provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-sonnet-4-20250514",    provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-haiku-4-5-20251001",   provider: "anthropic", pricing: { input: 1,    output: 5 } },

  // -------------------------------------------------------------------------
  // OpenAI
  // -------------------------------------------------------------------------
  // GPT-5.2 family
  { id: "gpt-5.2",                     provider: "openai", pricing: { input: 1.75, output: 14 } },
  { id: "gpt-5.2-pro",                 provider: "openai", pricing: { input: 21,   output: 168 } },
  // GPT-5 family
  { id: "gpt-5-2025-08-07",            provider: "openai", pricing: { input: 1.25, output: 10 } },
  { id: "gpt-5-mini-2025-08-07",       provider: "openai", pricing: { input: 0.25, output: 2 } },
  { id: "gpt-5-nano-2025-08-07",       provider: "openai", pricing: { input: 0.05, output: 0.4 } },
  // GPT-4.1 family
  { id: "gpt-4.1-2025-04-14",          provider: "openai", pricing: { input: 2,    output: 8 } },
  { id: "gpt-4.1-mini-2025-04-14",     provider: "openai", pricing: { input: 0.4,  output: 1.6 } },
  { id: "gpt-4.1-nano-2025-04-14",     provider: "openai", pricing: { input: 0.1,  output: 0.4 } },
  // GPT-4o family
  { id: "gpt-4o-2024-11-20",           provider: "openai", pricing: { input: 2.5,  output: 10 } },
  { id: "gpt-4o-mini-2024-07-18",      provider: "openai", pricing: { input: 0.15, output: 0.6 } },
  // O-series reasoning
  { id: "o3-2025-04-16",               provider: "openai", pricing: { input: 2,    output: 8 } },
  { id: "o3-mini-2025-01-31",          provider: "openai", pricing: { input: 1.1,  output: 4.4 } },
  { id: "o4-mini-2025-04-16",          provider: "openai", pricing: { input: 1.1,  output: 4.4 } },

  // -------------------------------------------------------------------------
  // Google
  // -------------------------------------------------------------------------
  // Gemini 3.x (preview)
  { id: "gemini-3.1-pro-preview",      provider: "google", pricing: { input: 2,    output: 12 } },
  { id: "gemini-3-pro-preview",        provider: "google", pricing: { input: 2,    output: 12 } },
  { id: "gemini-3-flash-preview",      provider: "google", pricing: { input: 0.5,  output: 3 } },
  // Gemini 2.5 (stable)
  { id: "gemini-2.5-pro",              provider: "google", pricing: { input: 1.25, output: 10 } },
  { id: "gemini-2.5-flash",            provider: "google", pricing: { input: 0.3,  output: 2.5 } },
  { id: "gemini-2.5-flash-lite",       provider: "google", pricing: { input: 0.1,  output: 0.4 } },

  // -------------------------------------------------------------------------
  // xAI (Grok)
  // -------------------------------------------------------------------------
  { id: "grok-4-0709",                 provider: "xai", pricing: { input: 3,    output: 15 } },
  { id: "grok-4-1-fast-reasoning",     provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  { id: "grok-4-1-fast-non-reasoning", provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  { id: "grok-code-fast-1",            provider: "xai", pricing: { input: 0.2,  output: 1.5 } },
  { id: "grok-3",                      provider: "xai", pricing: { input: 3,    output: 15 } },
  { id: "grok-3-mini",                 provider: "xai", pricing: { input: 0.3,  output: 0.5 } },

  // -------------------------------------------------------------------------
  // DeepSeek
  // -------------------------------------------------------------------------
  { id: "deepseek-chat",               provider: "deepseek", pricing: { input: 0.28, output: 0.42 } },
  { id: "deepseek-reasoner",           provider: "deepseek", pricing: { input: 0.28, output: 0.42 } },

  // -------------------------------------------------------------------------
  // Mistral AI
  // -------------------------------------------------------------------------
  // Generalist
  { id: "mistral-large-2512",          provider: "mistral", pricing: { input: 0.5,  output: 1.5 } },
  { id: "mistral-small-2506",          provider: "mistral", pricing: { input: 0.1,  output: 0.3 } },
  // Coding (agentic + completion)
  { id: "devstral-2512",               provider: "mistral", pricing: { input: 0.4,  output: 2 } },
  { id: "devstral-small-2-25-12",      provider: "mistral", pricing: { input: 0.1,  output: 0.3 } },
  { id: "codestral-2508",              provider: "mistral", pricing: { input: 0.3,  output: 0.9 } },
  // Reasoning
  { id: "magistral-medium-2509",       provider: "mistral", pricing: { input: 2,    output: 5 } },
  { id: "magistral-small-2509",        provider: "mistral", pricing: { input: 0.5,  output: 1.5 } },
];

// ---------------------------------------------------------------------------
// Cache multipliers (relative to input price)
// ---------------------------------------------------------------------------

export const CACHE_MULTIPLIERS: Record<string, { create: number; read: number }> = {
  anthropic: { create: 1.25, read: 0.1 },
  openai:    { create: 0,    read: 0.5 },
  google:    { create: 0,    read: 0.25 },
  xai:       { create: 1.0,  read: 0.25 },
  deepseek:  { create: 1.0,  read: 0.1 },
  mistral:   { create: 1.0,  read: 1.0 },
};

// ---------------------------------------------------------------------------
// Validation models — cheapest model per provider, used for key validation
// ---------------------------------------------------------------------------

export const VALIDATION_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai:    "gpt-4o-mini-2024-07-18",
  google:    "gemini-2.5-flash-lite",
  xai:       "grok-3-mini",
  deepseek:  "deepseek-chat",
  mistral:   "mistral-small-2506",
};

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

/** All provider IDs. */
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
