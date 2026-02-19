import { create } from "zustand";
import type { ProviderConfig } from "../../shared/types.ts";
import {
  initCrypto,
  encryptAndStore,
  loadAndDecrypt,
  isPlaintextJson,
  clearStorage,
} from "../lib/crypto.ts";

interface SettingsState {
  hasKeys: boolean;
  keysReady: boolean;
  anthropic: ProviderConfig | null;
  openai: ProviderConfig | null;
  google: ProviderConfig | null;
  loadKeys: () => Promise<void>;
  saveKeys: (keys: { anthropic?: ProviderConfig; openai?: ProviderConfig; google?: ProviderConfig }) => Promise<void>;
  clearKeys: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hasKeys: false,
  keysReady: false,
  anthropic: null,
  openai: null,
  google: null,
  loadKeys: async () => {
    try {
      await initCrypto();

      const raw = localStorage.getItem("apiKeys");
      if (!raw) {
        set({ keysReady: true });
        return;
      }

      let plaintext: string | null = null;

      if (isPlaintextJson(raw)) {
        plaintext = raw;
        await encryptAndStore(plaintext);
      } else {
        plaintext = await loadAndDecrypt();
      }

      if (plaintext) {
        const parsed = JSON.parse(plaintext);
        set({
          hasKeys: !!(parsed.anthropic?.apiKey || parsed.openai?.apiKey || parsed.google?.apiKey),
          anthropic: parsed.anthropic || null,
          openai: parsed.openai || null,
          google: parsed.google || null,
          keysReady: true,
        });
      } else {
        clearStorage();
        set({ hasKeys: false, keysReady: true });
      }
    } catch {
      clearStorage();
      set({ hasKeys: false, keysReady: true });
    }
  },
  saveKeys: async (keys) => {
    const state = get();
    const current = {
      anthropic: state.anthropic,
      openai: state.openai,
      google: state.google,
    };
    const merged = { ...current, ...keys };
    await encryptAndStore(JSON.stringify(merged));
    set({
      hasKeys: !!(merged.anthropic?.apiKey || merged.openai?.apiKey || merged.google?.apiKey),
      anthropic: merged.anthropic || null,
      openai: merged.openai || null,
      google: merged.google || null,
    });
  },
  clearKeys: () => {
    clearStorage();
    set({ hasKeys: false, anthropic: null, openai: null, google: null });
  },
}));
