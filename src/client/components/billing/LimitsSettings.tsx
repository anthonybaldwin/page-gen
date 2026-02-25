import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

interface Limits {
  maxTokensPerChat: number;
  maxAgentCallsPerRun: number;
  maxCostPerDay: number;
  maxCostPerProject: number;
}

const LIMIT_LABELS: Record<keyof Limits, { label: string; hint: string; step?: number }> = {
  maxTokensPerChat: { label: "Max tokens per chat", hint: "Token ceiling per chat session (0 = unlimited)" },
  maxAgentCallsPerRun: { label: "Max agent calls per run", hint: "Max agent invocations per pipeline run" },
  maxCostPerDay: { label: "Max cost per day ($)", hint: "Daily spending cap in USD (0 = unlimited)", step: 0.01 },
  maxCostPerProject: { label: "Max cost per project ($)", hint: "Per-project spending cap in USD (0 = unlimited)", step: 0.01 },
};

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof Limits)[];

export function LimitsSettings() {
  const [limits, setLimits] = useState<Limits>({
    maxTokensPerChat: 500000,
    maxAgentCallsPerRun: 30,
    maxCostPerDay: 0,
    maxCostPerProject: 0,
  });
  const [defaults, setDefaults] = useState<Limits>({
    maxTokensPerChat: 500000,
    maxAgentCallsPerRun: 30,
    maxCostPerDay: 0,
    maxCostPerProject: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ limits: Limits; limitDefaults: Limits }>("/settings")
      .then((res) => {
        setLimits(res.limits);
        setDefaults(res.limitDefaults);
      })
      .catch(console.error);
  }, []);

  const isCustom = (key: keyof Limits) => limits[key] !== defaults[key];
  const anyCustom = LIMIT_KEYS.some(isCustom);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await api.put<{ limits: Limits; defaults: Limits }>("/settings/limits", limits);
      setLimits(res.limits);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[limits] Failed to save:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSaveError(`Failed to save limits: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.delete<{ limits: Limits; defaults: Limits }>("/settings/limits");
      setLimits(res.limits);
      setSaved(false);
    } catch (err) {
      console.error("[limits] Failed to reset:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setSaveError(`Failed to reset limits: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Configure spending guardrails. Set to 0 for unlimited.
        </p>
        {anyCustom && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={saving}
            className="h-6 px-2 text-xs text-muted-foreground"
          >
            Reset all
          </Button>
        )}
      </div>

      {LIMIT_KEYS.map((key) => {
        const { label, hint, step } = LIMIT_LABELS[key];
        const custom = isCustom(key);
        return (
          <div key={key}>
            <div className="flex items-center gap-2 mb-1">
              <label className="block text-sm font-medium text-muted-foreground">
                {label}
              </label>
              {custom && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                  custom
                </span>
              )}
            </div>
            <Input
              type="number"
              min={0}
              step={step}
              value={limits[key]}
              onChange={(e) => setLimits((l) => ({ ...l, [key]: Number(e.target.value) }))}
            />
            <p className="text-xs text-muted-foreground/60 mt-1">
              {hint}
              {custom && <span className="ml-1">(default: {defaults[key]})</span>}
            </p>
          </div>
        );
      })}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved" : "Save Billing Limits"}
      </Button>
      {saveError && (
        <p className="text-sm text-destructive mt-2">{saveError}</p>
      )}
    </div>
  );
}
