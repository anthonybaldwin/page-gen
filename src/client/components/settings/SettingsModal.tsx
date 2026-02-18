import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { anthropic, openai, google, saveKeys, clearKeys } = useSettingsStore();
  const [keys, setKeys] = useState({
    anthropic: { apiKey: anthropic?.apiKey || "", proxyUrl: anthropic?.proxyUrl || "" },
    openai: { apiKey: openai?.apiKey || "", proxyUrl: openai?.proxyUrl || "" },
    google: { apiKey: google?.apiKey || "", proxyUrl: google?.proxyUrl || "" },
  });

  function handleSave() {
    const toSave: Record<string, { apiKey: string; proxyUrl?: string }> = {};
    for (const [key, val] of Object.entries(keys)) {
      if (val.apiKey.trim()) {
        toSave[key] = { apiKey: val.apiKey, ...(val.proxyUrl ? { proxyUrl: val.proxyUrl } : {}) };
      }
    }
    saveKeys(toSave);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            &times;
          </button>
        </div>

        <div className="space-y-4">
          {(["anthropic", "openai", "google"] as const).map((provider) => (
            <div key={provider}>
              <label className="block text-sm font-medium text-zinc-300 mb-1 capitalize">
                {provider} API Key
              </label>
              <input
                type="password"
                value={keys[provider].apiKey}
                onChange={(e) =>
                  setKeys((prev) => ({
                    ...prev,
                    [provider]: { ...prev[provider], apiKey: e.target.value },
                  }))
                }
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <input
                type="url"
                placeholder="Proxy URL (optional)"
                value={keys[provider].proxyUrl}
                onChange={(e) =>
                  setKeys((prev) => ({
                    ...prev,
                    [provider]: { ...prev[provider], proxyUrl: e.target.value },
                  }))
                }
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mt-2"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => {
              clearKeys();
              onClose();
            }}
            className="rounded-lg bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-600/30 transition-colors"
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}
