import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

export interface PipelineConfig {
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

const SECTIONS: { title: string; hint?: string; keys: ConfigKey[]; fields: Record<string, FieldMeta> }[] = [
  {
    title: "General",
    hint: "Agent defaults and versioning",
    keys: ["defaultMaxOutputTokens", "defaultMaxToolSteps", "warningThreshold", "maxVersionsRetained", "maxAgentVersionsPerRun"],
    fields: {
      defaultMaxOutputTokens: { label: "Max output tokens", hint: "Default token cap per agent" },
      defaultMaxToolSteps: { label: "Max tool steps", hint: "Default tool step cap per agent" },
      warningThreshold: { label: "Usage warning threshold", hint: "Token warning at this % of limit", displaySuffix: "%" },
      maxVersionsRetained: { label: "Max versions retained", hint: "Git commits kept per project" },
      maxAgentVersionsPerRun: { label: "Max auto-versions per run", hint: "Auto-commits per pipeline run" },
    },
  },
  {
    title: "Build",
    hint: "Build checks and fix loops",
    keys: ["buildTimeoutMs", "maxBuildFixAttempts", "buildFixMaxOutputTokens", "buildFixMaxToolSteps", "maxUniqueErrors"],
    fields: {
      buildTimeoutMs: { label: "Build timeout", hint: "Vite build check timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      maxBuildFixAttempts: { label: "Max build-fix attempts", hint: "Fix cycles per build failure" },
      buildFixMaxOutputTokens: { label: "Build-fix output tokens", hint: "Token cap for fix agents" },
      buildFixMaxToolSteps: { label: "Build-fix tool steps", hint: "Tool step cap for fix agents" },
      maxUniqueErrors: { label: "Max unique errors", hint: "Unique errors shown to fix agent" },
    },
  },
  {
    title: "Testing",
    hint: "Test run limits",
    keys: ["testTimeoutMs", "maxTestFailures"],
    fields: {
      testTimeoutMs: { label: "Test timeout", hint: "Vitest run timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      maxTestFailures: { label: "Max test failures", hint: "Test failures shown to fix agent" },
    },
  },
  {
    title: "Remediation",
    hint: "Code review / QA / security fix loop",
    keys: ["maxRemediationCycles"],
    fields: {
      maxRemediationCycles: { label: "Max remediation cycles", hint: "Code-review / fix rounds" },
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
          Global defaults — used when a flow node doesn't override the value.
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

      {SECTIONS.map((section, i) => (
        <div key={section.title}>
          {i > 0 && <hr className="border-border my-4" />}
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
            {section.title}
          </h4>
          {section.hint && (
            <p className="text-[10px] text-muted-foreground/50 mb-2">{section.hint}</p>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
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
