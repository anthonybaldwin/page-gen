import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

interface PipelineConfig {
  maxBuildFixAttempts: number;
  maxRemediationCycles: number;
  buildFixMaxOutputTokens: number;
  buildFixMaxToolSteps: number;
  defaultMaxOutputTokens: number;
  defaultMaxToolSteps: number;
  buildTimeoutMs: number;
  testTimeoutMs: number;
  maxTestFailures: number;
  maxUniqueErrors: number;
  warningThreshold: number;
  maxVersionsRetained: number;
  maxAgentVersionsPerRun: number;
}

type ConfigKey = keyof PipelineConfig;

interface FieldMeta {
  label: string;
  hint: string;
  step?: number;
  /** Display multiplier (e.g. ms → s = 0.001) */
  displayFactor?: number;
  displaySuffix?: string;
}

const SECTIONS: { title: string; keys: ConfigKey[]; fields: Record<string, FieldMeta> }[] = [
  {
    title: "Pipeline Execution",
    keys: ["maxBuildFixAttempts", "maxRemediationCycles", "buildFixMaxOutputTokens", "buildFixMaxToolSteps", "defaultMaxOutputTokens", "defaultMaxToolSteps"],
    fields: {
      maxBuildFixAttempts: { label: "Max build-fix attempts", hint: "Fix cycles per build failure" },
      maxRemediationCycles: { label: "Max remediation cycles", hint: "Code-review / fix rounds" },
      buildFixMaxOutputTokens: { label: "Build-fix max output tokens", hint: "Token cap for fix agents" },
      buildFixMaxToolSteps: { label: "Build-fix max tool steps", hint: "Tool step cap for fix agents" },
      defaultMaxOutputTokens: { label: "Default max output tokens", hint: "Fallback for agents without explicit limits" },
      defaultMaxToolSteps: { label: "Default max tool steps", hint: "Fallback for agents without explicit limits" },
    },
  },
  {
    title: "Timeouts",
    keys: ["buildTimeoutMs", "testTimeoutMs"],
    fields: {
      buildTimeoutMs: { label: "Build timeout", hint: "Vite build check timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      testTimeoutMs: { label: "Test timeout", hint: "Vitest run timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
    },
  },
  {
    title: "Review & Testing",
    keys: ["maxTestFailures", "maxUniqueErrors", "warningThreshold"],
    fields: {
      maxTestFailures: { label: "Max test failures", hint: "Test failures shown to fix agent" },
      maxUniqueErrors: { label: "Max unique errors", hint: "Unique errors shown to fix agent" },
      warningThreshold: { label: "Usage warning threshold", hint: "Token warning at this % of limit", displaySuffix: "%" },
    },
  },
  {
    title: "Versioning",
    keys: ["maxVersionsRetained", "maxAgentVersionsPerRun"],
    fields: {
      maxVersionsRetained: { label: "Max versions retained", hint: "Git commits kept per project" },
      maxAgentVersionsPerRun: { label: "Max auto-versions per run", hint: "Auto-commits per pipeline run" },
    },
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.keys);

const EMPTY_CONFIG: PipelineConfig = {
  maxBuildFixAttempts: 3,
  maxRemediationCycles: 2,
  buildFixMaxOutputTokens: 16000,
  buildFixMaxToolSteps: 10,
  defaultMaxOutputTokens: 8192,
  defaultMaxToolSteps: 10,
  buildTimeoutMs: 30000,
  testTimeoutMs: 60000,
  maxTestFailures: 5,
  maxUniqueErrors: 10,
  warningThreshold: 80,
  maxVersionsRetained: 50,
  maxAgentVersionsPerRun: 3,
};

export function PipelineSettings() {
  const [settings, setSettings] = useState<PipelineConfig>({ ...EMPTY_CONFIG });
  const [defaults, setDefaults] = useState<PipelineConfig>({ ...EMPTY_CONFIG });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ settings: PipelineConfig; defaults: PipelineConfig }>("/settings/pipeline")
      .then((res) => {
        setSettings(res.settings);
        setDefaults(res.defaults);
      })
      .catch(console.error);
  }, []);

  const isCustom = (key: ConfigKey) => settings[key] !== defaults[key];
  const anyCustom = ALL_KEYS.some(isCustom);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.put<{ settings: PipelineConfig; defaults: PipelineConfig }>("/settings/pipeline", settings);
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[pipeline] Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      const res = await api.delete<{ settings: PipelineConfig; defaults: PipelineConfig }>("/settings/pipeline");
      setSettings(res.settings);
      setSaved(false);
    } catch (err) {
      console.error("[pipeline] Failed to reset:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Tune pipeline execution limits, timeouts, and versioning caps.
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

      {SECTIONS.map((section) => (
        <div key={section.title}>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-3">
            {section.title}
          </h4>
          <div className="space-y-3">
            {section.keys.map((key) => {
              const meta = section.fields[key];
              if (!meta) return null;
              const custom = isCustom(key);
              const factor = meta.displayFactor ?? 1;
              const displayVal = factor !== 1 ? settings[key] * factor : settings[key];

              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm font-medium text-muted-foreground">
                      {meta.label}
                    </label>
                    {custom && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        custom
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step={meta.step}
                      value={displayVal}
                      onChange={(e) => {
                        const raw = Number(e.target.value);
                        const stored = factor !== 1 ? Math.round(raw / factor) : raw;
                        setSettings((s) => ({ ...s, [key]: stored }));
                      }}
                    />
                    {meta.displaySuffix && (
                      <span className="text-xs text-muted-foreground shrink-0">{meta.displaySuffix}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {meta.hint}
                    {custom && (
                      <span className="ml-1">
                        (default: {factor !== 1 ? defaults[key] * factor : defaults[key]}{meta.displaySuffix ?? ""})
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved" : "Save Pipeline Settings"}
      </Button>
    </div>
  );
}
