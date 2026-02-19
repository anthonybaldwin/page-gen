import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";

export function ApiKeySettings() {
  const { anthropic, openai, google, saveKeys, clearKeys } = useSettingsStore();
  const [keys, setKeys] = useState({
    anthropic: { apiKey: anthropic?.apiKey || "", proxyUrl: anthropic?.proxyUrl || "" },
    openai: { apiKey: openai?.apiKey || "", proxyUrl: openai?.proxyUrl || "" },
    google: { apiKey: google?.apiKey || "", proxyUrl: google?.proxyUrl || "" },
  });
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const toSave: Record<string, { apiKey: string; proxyUrl?: string }> = {};
    for (const [key, val] of Object.entries(keys)) {
      if (val.apiKey.trim()) {
        toSave[key] = { apiKey: val.apiKey, ...(val.proxyUrl ? { proxyUrl: val.proxyUrl } : {}) };
      }
    }
    await saveKeys(toSave);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
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

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          {saved ? "Saved" : "Save Keys"}
        </button>
        <button
          onClick={clearKeys}
          className="rounded-lg bg-red-600/20 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-600/30 transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
