import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { PROVIDER_IDS } from "../../../shared/providers.ts";
import type { ResolvedAgentConfig } from "../../../shared/types.ts";

export function ApiKeySettings() {
  const { providers: storeProviders, saveKeys, clearKeys } = useSettingsStore();
  const [keys, setKeys] = useState(
    () => Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, {
        apiKey: storeProviders[id]?.apiKey || "",
        proxyUrl: storeProviders[id]?.proxyUrl || "",
      }])
    )
  );
  const [saved, setSaved] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  // Sync local state when store changes (e.g. after clearKeys)
  useEffect(() => {
    setKeys(Object.fromEntries(
      PROVIDER_IDS.map((id) => [id, {
        apiKey: storeProviders[id]?.apiKey || "",
        proxyUrl: storeProviders[id]?.proxyUrl || "",
      }])
    ));
  }, [storeProviders]);

  async function handleSave() {
    setWarning(null);

    // Detect providers being removed (had a key before, now blank)
    const removedProviders = PROVIDER_IDS.filter(
      (id) => !!storeProviders[id]?.apiKey && !keys[id]?.apiKey?.trim()
    );

    // Check if any removed providers are in use by agents
    if (removedProviders.length > 0) {
      try {
        const agents = await api.get<ResolvedAgentConfig[]>("/settings/agents");
        const affected: string[] = [];
        for (const provider of removedProviders) {
          const using = agents.filter((a) => a.provider === provider);
          if (using.length > 0) {
            const names = using.map((a) => a.displayName).join(", ");
            affected.push(`${provider}: ${names}`);
          }
        }
        if (affected.length > 0) {
          setWarning(`These agents use providers you're removing keys for — they'll fail until reassigned:\n${affected.join("\n")}`);
        }
      } catch { /* non-blocking — save anyway */ }
    }

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

  function handleClearAll() {
    clearKeys();
    setWarning(null);
  }

  return (
    <div className="space-y-4">
      {PROVIDER_IDS.map((provider) => (
        <div key={provider}>
          <label className="block text-sm font-medium text-muted-foreground mb-1 capitalize">
            {provider} API Key
          </label>
          <Input
            type="password"
            value={keys[provider]?.apiKey ?? ""}
            onChange={(e) =>
              setKeys((prev) => ({
                ...prev,
                [provider]: { apiKey: e.target.value, proxyUrl: prev[provider]?.proxyUrl ?? "" },
              }))
            }
          />
          <Input
            type="url"
            placeholder="Proxy URL (optional)"
            value={keys[provider]?.proxyUrl ?? ""}
            onChange={(e) =>
              setKeys((prev) => ({
                ...prev,
                [provider]: { apiKey: prev[provider]?.apiKey ?? "", proxyUrl: e.target.value },
              }))
            }
            className="mt-2"
          />
        </div>
      ))}

      {warning && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <p className="text-xs text-amber-400 whitespace-pre-line">{warning}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSave} className="flex-1">
          {saved ? "Saved" : "Save Keys"}
        </Button>
        <Button variant="destructive" onClick={handleClearAll}>
          Clear All
        </Button>
      </div>
    </div>
  );
}
