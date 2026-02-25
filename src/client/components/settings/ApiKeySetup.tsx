import { useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../ui/card.tsx";
import { Loader2 } from "lucide-react";
import { PROVIDERS } from "../../../shared/providers.ts";

export function ApiKeySetup({ onComplete }: { onComplete: () => void }) {
  const saveKeys = useSettingsStore((s) => s.saveKeys);
  const [keys, setKeys] = useState<Record<string, { apiKey: string; proxyUrl: string }>>(
    () => Object.fromEntries(PROVIDERS.map((p) => [p.id, { apiKey: "", proxyUrl: "" }]))
  );
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
      const entry = keys[provider.id];
      if (!entry?.apiKey.trim()) continue;

      try {
        const res = await fetch("/api/settings/validate-key", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [`X-Api-Key-${provider.headerKey}`]: entry.apiKey,
            ...(entry.proxyUrl ? { [`X-Proxy-Url-${provider.headerKey}`]: entry.proxyUrl } : {}),
          },
          body: JSON.stringify({ provider: provider.id }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Validation failed" }));
          newErrors[provider.id] = (body as { error: string }).error;
        } else {
          validKeys[provider.id] = {
            apiKey: entry.apiKey,
            ...(entry.proxyUrl ? { proxyUrl: entry.proxyUrl } : {}),
          };
        }
      } catch (err) {
        console.warn(`[api-key] Validation request failed for ${provider.id}, accepting key without validation:`, err);
        validKeys[provider.id] = {
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

    await saveKeys(validKeys);
    onComplete();
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <Card className="w-full max-w-lg border-border">
        <CardHeader>
          <CardTitle className="text-xl">Welcome to Page Gen.</CardTitle>
          <CardDescription>
            Enter at least one API key to get started. Keys are stored locally in your browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {PROVIDERS.map((provider) => (
              <div key={provider.id}>
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  {provider.label} API Key
                </label>
                <Input
                  type="password"
                  placeholder={provider.placeholder}
                  value={keys[provider.id]?.apiKey || ""}
                  onChange={(e) =>
                    setKeys((prev) => ({
                      ...prev,
                      [provider.id]: { ...prev[provider.id]!, apiKey: e.target.value },
                    }))
                  }
                />
                {errors[provider.id] && (
                  <p className="text-xs text-destructive mt-1">{errors[provider.id]}</p>
                )}
                {showProxy && (
                  <Input
                    type="url"
                    placeholder={provider.proxyPlaceholder}
                    value={keys[provider.id]?.proxyUrl || ""}
                    onChange={(e) =>
                      setKeys((prev) => ({
                        ...prev,
                        [provider.id]: { ...prev[provider.id]!, proxyUrl: e.target.value },
                      }))
                    }
                    className="mt-2"
                  />
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0 text-xs"
              onClick={() => setShowProxy(!showProxy)}
            >
              {showProxy ? "Hide proxy URLs" : "Configure proxy URLs (optional)"}
            </Button>

            <Button
              type="submit"
              disabled={!hasAnyKey || validating}
              className="w-full"
            >
              {validating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {validating ? "Validating..." : "Get Started"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
