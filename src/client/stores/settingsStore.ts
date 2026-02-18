import { create } from "zustand";
import type { ProviderConfig } from "../../shared/types.ts";

interface SettingsState {
  hasKeys: boolean;
  anthropic: ProviderConfig | null;
  openai: ProviderConfig | null;
  google: ProviderConfig | null;
  loadKeys: () => void;
  saveKeys: (keys: { anthropic?: ProviderConfig; openai?: ProviderConfig; google?: ProviderConfig }) => void;
  clearKeys: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hasKeys: false,
  anthropic: null,
  openai: null,
  google: null,
  loadKeys: () => {
    try {
      const stored = localStorage.getItem("apiKeys");
      if (stored) {
        const parsed = JSON.parse(stored);
        set({
          hasKeys: !!(parsed.anthropic?.apiKey || parsed.openai?.apiKey || parsed.google?.apiKey),
          anthropic: parsed.anthropic || null,
          openai: parsed.openai || null,
          google: parsed.google || null,
        });
      }
    } catch {
      // ignore parse errors
    }
  },
  saveKeys: (keys) => {
    const current = JSON.parse(localStorage.getItem("apiKeys") || "{}");
    const merged = { ...current, ...keys };
    localStorage.setItem("apiKeys", JSON.stringify(merged));
    set({
      hasKeys: !!(merged.anthropic?.apiKey || merged.openai?.apiKey || merged.google?.apiKey),
      anthropic: merged.anthropic || null,
      openai: merged.openai || null,
      google: merged.google || null,
    });
  },
  clearKeys: () => {
    localStorage.removeItem("apiKeys");
    set({ hasKeys: false, anthropic: null, openai: null, google: null });
  },
}));
