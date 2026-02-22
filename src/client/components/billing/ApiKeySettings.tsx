import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { PROVIDER_IDS } from "../../../shared/providers.ts";

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
                [provider]: { ...prev[provider], apiKey: e.target.value },
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
                [provider]: { ...prev[provider], proxyUrl: e.target.value },
              }))
            }
            className="mt-2"
          />
        </div>
      ))}

      <div className="flex gap-3">
        <Button onClick={handleSave} className="flex-1">
          {saved ? "Saved" : "Save Keys"}
        </Button>
        <Button variant="destructive" onClick={clearKeys}>
          Clear All
        </Button>
      </div>
    </div>
  );
}
