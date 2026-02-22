import { create } from "zustand";
import type { ProviderConfig } from "../../shared/types.ts";
import { PROVIDER_IDS } from "../../shared/providers.ts";
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
  providers: Record<string, ProviderConfig | null>;
  loadKeys: () => Promise<void>;
  saveKeys: (keys: Record<string, ProviderConfig | undefined>) => Promise<void>;
  clearKeys: () => void;
}

function emptyProviders(): Record<string, ProviderConfig | null> {
  const result: Record<string, ProviderConfig | null> = {};
  for (const id of PROVIDER_IDS) result[id] = null;
  return result;
}

function hasAnyKey(providers: Record<string, ProviderConfig | null>): boolean {
  return PROVIDER_IDS.some((id) => !!providers[id]?.apiKey);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hasKeys: false,
  keysReady: false,
  providers: emptyProviders(),
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
        const providers: Record<string, ProviderConfig | null> = {};
        for (const id of PROVIDER_IDS) {
          providers[id] = parsed[id] || null;
        }
        set({
          hasKeys: hasAnyKey(providers),
          providers,
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
    const merged: Record<string, ProviderConfig | null> = { ...state.providers };
    for (const [id, val] of Object.entries(keys)) {
      if (val !== undefined) merged[id] = val;
    }
    await encryptAndStore(JSON.stringify(merged));
    set({
      hasKeys: hasAnyKey(merged),
      providers: merged,
    });
  },
  clearKeys: () => {
    clearStorage();
    set({ hasKeys: false, providers: emptyProviders() });
  },
}));
