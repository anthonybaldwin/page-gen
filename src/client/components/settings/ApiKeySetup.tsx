import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";

interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
  proxyPlaceholder: string;
}

const PROVIDERS: ProviderField[] = [
  {
    key: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    proxyPlaceholder: "https://api.anthropic.com",
  },
  {
    key: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    proxyPlaceholder: "https://api.openai.com",
  },
  {
    key: "google",
    label: "Google AI",
    placeholder: "AIza...",
    proxyPlaceholder: "https://generativelanguage.googleapis.com",
  },
];

export function ApiKeySetup({ onComplete }: { onComplete: () => void }) {
  const saveKeys = useSettingsStore((s) => s.saveKeys);
  const [keys, setKeys] = useState<Record<string, { apiKey: string; proxyUrl: string }>>({
    anthropic: { apiKey: "", proxyUrl: "" },
    openai: { apiKey: "", proxyUrl: "" },
    google: { apiKey: "", proxyUrl: "" },
  });
  const [showProxy, setShowProxy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const hasAnyKey = Object.values(keys).some((k) => k.apiKey.trim() !== "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hasAnyKey) return;

    setValidating(true);
    setErrors({});

    const newErrors: Record<string, string> = {};
    const validKeys: Record<string, { apiKey: string; proxyUrl?: string }> = {};

    for (const provider of PROVIDERS) {
      const entry = keys[provider.key];
      if (!entry?.apiKey.trim()) continue;

      try {
        const res = await fetch("/api/settings/validate-key", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [`X-Api-Key-${provider.label.replace(/\s/g, "")}`]: entry.apiKey,
            ...(entry.proxyUrl ? { [`X-Proxy-Url-${provider.label.replace(/\s/g, "")}`]: entry.proxyUrl } : {}),
          },
          body: JSON.stringify({ provider: provider.key }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Validation failed" }));
          newErrors[provider.key] = (body as { error: string }).error;
        } else {
          validKeys[provider.key] = {
            apiKey: entry.apiKey,
            ...(entry.proxyUrl ? { proxyUrl: entry.proxyUrl } : {}),
          };
        }
      } catch {
        // If validation endpoint not yet available, accept the key
        validKeys[provider.key] = {
          apiKey: entry.apiKey,
          ...(entry.proxyUrl ? { proxyUrl: entry.proxyUrl } : {}),
        };
      }
    }

    setValidating(false);

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    saveKeys(validKeys);
    onComplete();
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 w-full max-w-lg">
        <h2 className="text-xl font-bold text-white mb-2">Welcome to Just Build It</h2>
        <p className="text-sm text-zinc-400 mb-6">
          Enter at least one API key to get started. Keys are stored locally in your browser.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {PROVIDERS.map((provider) => (
            <div key={provider.key}>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                {provider.label} API Key
              </label>
              <input
                type="password"
                placeholder={provider.placeholder}
                value={keys[provider.key]?.apiKey || ""}
                onChange={(e) =>
                  setKeys((prev) => ({
                    ...prev,
                    [provider.key]: { ...prev[provider.key]!, apiKey: e.target.value },
                  }))
                }
                className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
              {errors[provider.key] && (
                <p className="text-xs text-red-400 mt-1">{errors[provider.key]}</p>
              )}
              {showProxy && (
                <input
                  type="url"
                  placeholder={provider.proxyPlaceholder}
                  value={keys[provider.key]?.proxyUrl || ""}
                  onChange={(e) =>
                    setKeys((prev) => ({
                      ...prev,
                      [provider.key]: { ...prev[provider.key]!, proxyUrl: e.target.value },
                    }))
                  }
                  className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mt-2"
                />
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setShowProxy(!showProxy)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showProxy ? "Hide proxy URLs" : "Configure proxy URLs (optional)"}
          </button>

          <button
            type="submit"
            disabled={!hasAnyKey || validating}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {validating ? "Validating..." : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}
