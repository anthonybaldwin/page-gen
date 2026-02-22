/**
 * Centralized provider & model configuration.
 * Single source of truth imported by both client and server.
 *
 * Adding a new provider:
 *  1. Add an entry to PROVIDERS, MODELS, CACHE_MULTIPLIERS, VALIDATION_MODELS here
 *  2. Add 1 line to SDK_FACTORIES in src/server/providers/registry.ts + npm install
 *
 * ─── Reference Links ───────────────────────────────────────────────────
 *
 * AI SDK (Vercel) provider docs:
 *   OpenAI    — https://ai-sdk.dev/providers/ai-sdk-providers/openai
 *   Anthropic — https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
 *   Google    — https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai
 *   xAI       — https://ai-sdk.dev/providers/ai-sdk-providers/xai
 *   DeepSeek  — https://ai-sdk.dev/providers/ai-sdk-providers/deepseek
 *   Mistral   — https://ai-sdk.dev/providers/ai-sdk-providers/mistral
 *
 * Official pricing pages:
 *   Anthropic — https://platform.claude.com/docs/en/about-claude/pricing
 *   OpenAI    — https://platform.openai.com/docs/pricing
 *   Google    — https://ai.google.dev/gemini-api/docs/pricing
 *   xAI       — https://docs.x.ai/developers/models
 *   DeepSeek  — https://api-docs.deepseek.com/quick_start/pricing
 *   Mistral   — https://docs.mistral.ai/getting-started/models
 *
 * Official model catalogs:
 *   Anthropic — https://platform.claude.com/docs/en/about-claude/models/overview
 *   OpenAI    — https://developers.openai.com/api/docs/models
 *   Google    — https://ai.google.dev/gemini-api/docs/models
 *   xAI       — https://docs.x.ai/developers/models
 *   DeepSeek  — https://api-docs.deepseek.com/api/list-models
 *   Mistral   — https://docs.mistral.ai/getting-started/models
 *
 * Deprecation trackers:
 *   Anthropic — https://platform.claude.com/docs/en/about-claude/model-deprecations
 *   OpenAI    — https://developers.openai.com/api/docs/deprecations
 *
 * Voice docs:
 *   OpenAI TTS    — https://platform.openai.com/docs/guides/text-to-speech
 *   OpenAI RT     — https://platform.openai.com/docs/guides/realtime
 *   Google TTS    — https://ai.google.dev/gemini-api/docs/speech-generation
 *   xAI Voice     — https://docs.x.ai/docs/guides/voice/agent
 *
 * Compatibility notes (verified Feb 2026, AI SDK v6):
 *   - openai(): auto-routes to Responses API; system messages auto-converted
 *     to developer messages for o-series reasoning models
 *   - Voice/TTS/realtime models (7 total) won't work with generateText/streamText —
 *     cataloged here for future voice feature, not for text agents
 *   - All other 64 models work as drop-in agent assignments via Settings
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
// Voice definitions
// ---------------------------------------------------------------------------

export interface VoiceDef {
  id: string;
  gender?: "male" | "female" | "neutral";
}

/**
 * Provider-level voice catalogs.
 * Models reference these via the optional `voices` field on ModelDef.
 */
export const PROVIDER_VOICES: Record<string, VoiceDef[]> = {
  openai: [
    { id: "alloy",   gender: "neutral" },
    { id: "ash",     gender: "male" },
    { id: "ballad",  gender: "male" },
    { id: "cedar",   gender: "male" },
    { id: "coral",   gender: "female" },
    { id: "echo",    gender: "male" },
    { id: "fable",   gender: "male" },
    { id: "marin",   gender: "female" },
    { id: "nova",    gender: "female" },
    { id: "onyx",    gender: "male" },
    { id: "sage",    gender: "female" },
    { id: "shimmer", gender: "female" },
    { id: "verse",   gender: "male" },
  ],
  google: [
    { id: "Achernar",      gender: "female" },
    { id: "Achird",        gender: "male" },
    { id: "Algenib",       gender: "male" },
    { id: "Algieba",       gender: "male" },
    { id: "Alnilam",       gender: "male" },
    { id: "Aoede",         gender: "female" },
    { id: "Autonoe",       gender: "female" },
    { id: "Callirrhoe",    gender: "female" },
    { id: "Charon",        gender: "male" },
    { id: "Despina",       gender: "female" },
    { id: "Enceladus",     gender: "male" },
    { id: "Erinome",       gender: "female" },
    { id: "Fenrir",        gender: "male" },
    { id: "Gacrux",        gender: "female" },
    { id: "Iapetus",       gender: "male" },
    { id: "Kore",          gender: "female" },
    { id: "Laomedeia",     gender: "female" },
    { id: "Leda",          gender: "female" },
    { id: "Orus",          gender: "male" },
    { id: "Puck",          gender: "male" },
    { id: "Pulcherrima",   gender: "female" },
    { id: "Rasalgethi",    gender: "male" },
    { id: "Sadachbia",     gender: "male" },
    { id: "Sadaltager",    gender: "male" },
    { id: "Schedar",       gender: "male" },
    { id: "Sulafat",       gender: "female" },
    { id: "Umbriel",       gender: "male" },
    { id: "Vindemiatrix",  gender: "female" },
    { id: "Zephyr",        gender: "female" },
    { id: "Zubenelgenubi", gender: "male" },
  ],
  xai: [
    { id: "Ara", gender: "female" },
    { id: "Eve", gender: "female" },
    { id: "Leo", gender: "male" },
    { id: "Rex", gender: "male" },
    { id: "Sal", gender: "neutral" },
  ],
};

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------

export interface ModelDef {
  id: string;
  provider: string;
  pricing: { input: number; output: number };
  /**
   * Voice support. Omit for non-voice models.
   *  - `"all"` → model supports every voice in PROVIDER_VOICES[provider]
   *  - `string[]` → model supports only these specific voice IDs
   */
  voices?: "all" | string[];
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
  // Current generation
  { id: "claude-opus-4-6",             provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-sonnet-4-6",           provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-haiku-4-5-20251001",   provider: "anthropic", pricing: { input: 1,    output: 5 } },
  // Previous generation (still active)
  { id: "claude-opus-4-5-20251101",    provider: "anthropic", pricing: { input: 5,    output: 25 } },
  { id: "claude-sonnet-4-5-20250929",  provider: "anthropic", pricing: { input: 3,    output: 15 } },
  { id: "claude-sonnet-4-20250514",    provider: "anthropic", pricing: { input: 3,    output: 15 } },
  // Legacy (premium pricing)
  { id: "claude-opus-4-1-20250805",    provider: "anthropic", pricing: { input: 15,   output: 75 } },
  { id: "claude-opus-4-20250514",      provider: "anthropic", pricing: { input: 15,   output: 75 } },

  // -------------------------------------------------------------------------
  // OpenAI
  // -------------------------------------------------------------------------
  // GPT-5.2 family (latest flagship)
  { id: "gpt-5.2",                     provider: "openai", pricing: { input: 1.75, output: 14 } },
  { id: "gpt-5.2-pro",                 provider: "openai", pricing: { input: 21,   output: 168 } },
  // GPT-5.1
  { id: "gpt-5.1",                     provider: "openai", pricing: { input: 1.25, output: 10 } },
  // GPT-5 family
  { id: "gpt-5-2025-08-07",            provider: "openai", pricing: { input: 1.25, output: 10 } },
  { id: "gpt-5-mini-2025-08-07",       provider: "openai", pricing: { input: 0.25, output: 2 } },
  { id: "gpt-5-nano-2025-08-07",       provider: "openai", pricing: { input: 0.05, output: 0.4 } },
  { id: "gpt-5-pro",                   provider: "openai", pricing: { input: 15,   output: 120 } },
  // Codex (coding-optimized)
  { id: "gpt-5.2-codex",               provider: "openai", pricing: { input: 1.75, output: 14 } },
  { id: "gpt-5.1-codex",               provider: "openai", pricing: { input: 1.25, output: 10 } },
  { id: "gpt-5.1-codex-mini",          provider: "openai", pricing: { input: 0.25, output: 2 } },
  { id: "gpt-5.1-codex-max",           provider: "openai", pricing: { input: 1.25, output: 10 } },
  { id: "gpt-5-codex",                 provider: "openai", pricing: { input: 1.25, output: 10 } },
  // GPT-4.1 family
  { id: "gpt-4.1-2025-04-14",          provider: "openai", pricing: { input: 2,    output: 8 } },
  { id: "gpt-4.1-mini-2025-04-14",     provider: "openai", pricing: { input: 0.4,  output: 1.6 } },
  { id: "gpt-4.1-nano-2025-04-14",     provider: "openai", pricing: { input: 0.1,  output: 0.4 } },
  // GPT-4o family
  { id: "gpt-4o-2024-11-20",           provider: "openai", pricing: { input: 2.5,  output: 10 } },
  { id: "gpt-4o-mini-2024-07-18",      provider: "openai", pricing: { input: 0.15, output: 0.6 } },
  // O-series reasoning
  { id: "o3-pro-2025-06-10",           provider: "openai", pricing: { input: 20,   output: 80 } },
  { id: "o3-2025-04-16",               provider: "openai", pricing: { input: 2,    output: 8 } },
  { id: "o3-mini-2025-01-31",          provider: "openai", pricing: { input: 1.1,  output: 4.4 } },
  { id: "o4-mini-2025-04-16",          provider: "openai", pricing: { input: 1.1,  output: 4.4 } },
  { id: "o1",                          provider: "openai", pricing: { input: 15,   output: 60 } },
  { id: "o1-pro",                      provider: "openai", pricing: { input: 150,  output: 600 } },
  { id: "o1-mini",                     provider: "openai", pricing: { input: 1.1,  output: 4.4 } },
  // Voice / TTS (text input tokens → audio output tokens)
  { id: "gpt-4o-mini-tts-2025-12-15",  provider: "openai", pricing: { input: 0.6,  output: 12 }, voices: "all" },
  // Audio (multimodal text + audio; text token pricing shown)
  { id: "gpt-4o-audio-preview",        provider: "openai", pricing: { input: 2.5,  output: 10 }, voices: "all" },
  { id: "gpt-4o-mini-audio-preview",   provider: "openai", pricing: { input: 0.15, output: 0.6 }, voices: "all" },
  // Realtime voice (text token pricing; audio tokens priced separately at ~5-8x)
  { id: "gpt-realtime",                provider: "openai", pricing: { input: 4,    output: 16 },
    voices: ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"] },
  { id: "gpt-realtime-mini",           provider: "openai", pricing: { input: 0.6,  output: 2.4 },
    voices: ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"] },

  // -------------------------------------------------------------------------
  // Google
  // -------------------------------------------------------------------------
  // Gemini 3.x (preview)
  { id: "gemini-3.1-pro-preview",      provider: "google", pricing: { input: 2,    output: 12 } },
  { id: "gemini-3-pro-preview",        provider: "google", pricing: { input: 2,    output: 12 } },
  { id: "gemini-3-flash-preview",      provider: "google", pricing: { input: 0.5,  output: 3 } },
  // Gemini 3 image generation (multimodal; text token pricing)
  { id: "gemini-3-pro-image-preview",  provider: "google", pricing: { input: 2,    output: 12 } },
  // Gemini 2.5 (stable)
  { id: "gemini-2.5-pro",              provider: "google", pricing: { input: 1.25, output: 10 } },
  { id: "gemini-2.5-flash",            provider: "google", pricing: { input: 0.3,  output: 2.5 } },
  { id: "gemini-2.5-flash-lite",       provider: "google", pricing: { input: 0.1,  output: 0.4 } },
  // Voice / TTS (text input tokens → audio output tokens)
  { id: "gemini-2.5-flash-preview-tts", provider: "google", pricing: { input: 0.5,  output: 10 }, voices: "all" },
  { id: "gemini-2.5-pro-preview-tts",   provider: "google", pricing: { input: 1,    output: 20 }, voices: "all" },

  // -------------------------------------------------------------------------
  // xAI (Grok)
  // -------------------------------------------------------------------------
  // Grok 4 family
  { id: "grok-4-0709",                 provider: "xai", pricing: { input: 3,    output: 15 } },
  { id: "grok-4-1-fast-reasoning",     provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  { id: "grok-4-1-fast-non-reasoning", provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  { id: "grok-4-fast-reasoning",       provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  { id: "grok-4-fast-non-reasoning",   provider: "xai", pricing: { input: 0.2,  output: 0.5 } },
  // Coding
  { id: "grok-code-fast-1",            provider: "xai", pricing: { input: 0.2,  output: 1.5 } },
  // Grok 3 family
  { id: "grok-3",                      provider: "xai", pricing: { input: 3,    output: 15 } },
  { id: "grok-3-mini",                 provider: "xai", pricing: { input: 0.3,  output: 0.5 } },
  // Vision
  { id: "grok-2-vision-1212",          provider: "xai", pricing: { input: 2,    output: 10 } },

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
  { id: "mistral-medium-2508",         provider: "mistral", pricing: { input: 0.4,  output: 2 } },
  { id: "mistral-small-2506",          provider: "mistral", pricing: { input: 0.1,  output: 0.3 } },
  { id: "mistral-small-creative-2512", provider: "mistral", pricing: { input: 0.1,  output: 0.3 } },
  // Ministral (small / edge)
  { id: "ministral-3b-2512",           provider: "mistral", pricing: { input: 0.1,  output: 0.1 } },
  { id: "ministral-8b-2512",           provider: "mistral", pricing: { input: 0.15, output: 0.15 } },
  { id: "ministral-14b-2512",          provider: "mistral", pricing: { input: 0.2,  output: 0.2 } },
  // Coding (agentic + completion)
  { id: "devstral-2512",               provider: "mistral", pricing: { input: 0.4,  output: 2 } },
  { id: "devstral-medium-2507",        provider: "mistral", pricing: { input: 0.4,  output: 2 } },
  { id: "devstral-small-2-25-12",      provider: "mistral", pricing: { input: 0.1,  output: 0.3 } },
  { id: "codestral-2508",              provider: "mistral", pricing: { input: 0.3,  output: 0.9 } },
  // Multimodal / vision
  { id: "pixtral-large-2411",          provider: "mistral", pricing: { input: 2,    output: 6 } },
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

/** Get the available voices for a model, or empty array if not a voice model. */
export function getVoicesForModel(modelId: string): VoiceDef[] {
  const model = MODEL_MAP[modelId];
  if (!model?.voices) return [];
  const catalog = PROVIDER_VOICES[model.provider] ?? [];
  if (model.voices === "all") return catalog;
  return catalog.filter((v) => (model.voices as string[]).includes(v.id));
}

/** Check if a model supports voice output. */
export function isVoiceModel(modelId: string): boolean {
  return !!MODEL_MAP[modelId]?.voices;
}
