import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

export interface PipelineConfig {
  [key: string]: number;
}

type ConfigKey = string;

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
    hint: "Agent defaults, versioning, and streaming",
    keys: ["defaultMaxOutputTokens", "defaultMaxToolSteps", "warningThreshold", "maxVersionsRetained", "maxAgentVersionsPerRun", "streamThrottleMs", "titleMaxChars"],
    fields: {
      defaultMaxOutputTokens: { label: "Max output tokens", hint: "Default token cap per agent" },
      defaultMaxToolSteps: { label: "Max tool steps", hint: "Default tool step cap per agent" },
      warningThreshold: { label: "Usage warning threshold", hint: "Token warning at this % of limit", displaySuffix: "%" },
      maxVersionsRetained: { label: "Max versions retained", hint: "Git commits kept per project" },
      maxAgentVersionsPerRun: { label: "Max auto-versions per run", hint: "Auto-commits per pipeline run" },
      streamThrottleMs: { label: "Stream throttle", hint: "Delay between SSE broadcasts", displaySuffix: "ms" },
      titleMaxChars: { label: "Title max chars", hint: "Auto-generated chat title truncation" },
    },
  },
  {
    title: "Build",
    hint: "Build checks and fix loops",
    keys: ["buildTimeoutMs", "maxBuildFixAttempts", "buildFixMaxOutputTokens", "buildFixMaxToolSteps", "maxUniqueErrors"],
    fields: {
      buildTimeoutMs: { label: "Build timeout", hint: "Build check timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      maxBuildFixAttempts: { label: "Max build-fix attempts", hint: "Fix cycles per build failure" },
      buildFixMaxOutputTokens: { label: "Build-fix output tokens", hint: "Token cap for fix agents" },
      buildFixMaxToolSteps: { label: "Build-fix tool steps", hint: "Tool step cap for fix agents" },
      maxUniqueErrors: { label: "Max unique errors", hint: "Unique errors shown to fix agent" },
    },
  },
  {
    title: "Testing",
    hint: "Test run limits",
    keys: ["testTimeoutMs", "maxTestFailures", "testRunMaxAttempts"],
    fields: {
      testTimeoutMs: { label: "Test timeout", hint: "Test run timeout", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      maxTestFailures: { label: "Max test failures", hint: "Test failures shown to fix agent" },
      testRunMaxAttempts: { label: "Max test-fix attempts", hint: "Fix cycles per test failure" },
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
  {
    title: "Shell Actions",
    hint: "Shell command node defaults",
    keys: ["shellCommandTimeoutMs", "shellMaxOutputLength"],
    fields: {
      shellCommandTimeoutMs: { label: "Shell timeout", hint: "Default timeout for shell commands", displayFactor: 0.001, displaySuffix: "s", step: 1000 },
      shellMaxOutputLength: { label: "Max output length", hint: "Chars captured from shell stdout" },
    },
  },
  {
    title: "LLM Actions",
    hint: "LLM call, summary, and classification defaults",
    keys: ["llmCallMaxOutputTokens", "summaryMaxOutputTokens", "summaryDigestTruncateChars", "questionMaxOutputTokens", "classifyMaxOutputTokens", "classifyMaxHistoryMessages", "classifyMaxHistoryChars"],
    fields: {
      llmCallMaxOutputTokens: { label: "LLM-call max tokens", hint: "Default token cap for LLM-call nodes" },
      summaryMaxOutputTokens: { label: "Summary max tokens", hint: "Token cap for summary generation" },
      summaryDigestTruncateChars: { label: "Summary digest truncation", hint: "Agent output chars included in digest" },
      questionMaxOutputTokens: { label: "Question max tokens", hint: "Token cap for question answering" },
      classifyMaxOutputTokens: { label: "Classify max tokens", hint: "Token cap for intent classification" },
      classifyMaxHistoryMessages: { label: "Classify history messages", hint: "Recent messages included for context" },
      classifyMaxHistoryChars: { label: "Classify history chars", hint: "Max chars of conversation history" },
    },
  },
  {
    title: "Mood Analysis",
    hint: "Vision-based mood board analysis",
    keys: ["moodAnalysisMaxImages", "moodAnalysisMaxOutputTokens"],
    fields: {
      moodAnalysisMaxImages: { label: "Max images", hint: "Images processed from mood board" },
      moodAnalysisMaxOutputTokens: { label: "Max output tokens", hint: "Token cap for mood analysis" },
    },
  },
];

const ALL_KEYS = SECTIONS.flatMap((s) => s.keys);

const EMPTY_CONFIG: PipelineConfig = {};

export function PipelineSettings() {
  const [settings, setSettings] = useState<PipelineConfig>({ ...EMPTY_CONFIG });
  const [defaults, setDefaults] = useState<PipelineConfig>({ ...EMPTY_CONFIG });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Intent classification prompt state
  const [intentPrompt, setIntentPrompt] = useState("");
  const [intentDefault, setIntentDefault] = useState("");
  const [intentIsCustom, setIntentIsCustom] = useState(false);
  const [intentSaving, setIntentSaving] = useState(false);
  const [intentSaved, setIntentSaved] = useState(false);
  // Fail signals state
  const [failSignalsText, setFailSignalsText] = useState("");
  const [failSignalsDefaults, setFailSignalsDefaults] = useState<string[]>([]);
  const [failSignalsIsCustom, setFailSignalsIsCustom] = useState(false);
  const [failSignalsSaving, setFailSignalsSaving] = useState(false);
  const [failSignalsSaved, setFailSignalsSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ settings: PipelineConfig; defaults: PipelineConfig }>("/settings/pipeline")
      .then((res) => {
        setSettings(res.settings);
        setDefaults(res.defaults);
      })
      .catch(console.error);
    api
      .get<{ prompt: string; isCustom: boolean; defaultPrompt: string }>("/settings/intent/classifyPrompt")
      .then((res) => {
        setIntentPrompt(res.prompt);
        setIntentDefault(res.defaultPrompt);
        setIntentIsCustom(res.isCustom);
      })
      .catch(console.error);
    api
      .get<{ signals: string[]; defaults: string[]; isCustom: boolean }>("/settings/pipeline/failSignals")
      .then((res) => {
        setFailSignalsText(res.signals.join("\n"));
        setFailSignalsDefaults(res.defaults);
        setFailSignalsIsCustom(res.isCustom);
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

      {/* Intent Classification section */}
      <hr className="border-border my-4" />
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
        Intent Classification
      </h4>
      <p className="text-[10px] text-muted-foreground/50 mb-2">
        This prompt classifies user messages as build/fix/question and determines scope.
      </p>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="block text-sm font-medium text-muted-foreground">
            Classification Prompt
          </label>
          {intentIsCustom && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              custom
            </span>
          )}
        </div>
        <textarea
          value={intentPrompt}
          onChange={(e) => {
            setIntentPrompt(e.target.value);
            setIntentIsCustom(e.target.value !== intentDefault);
          }}
          rows={8}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-y"
        />
        <p className="text-xs text-muted-foreground/60 mt-1">
          Must return JSON: {"{"}"intent","scope","needsBackend","reasoning"{"}"}
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <Button
          onClick={async () => {
            setIntentSaving(true);
            setIntentSaved(false);
            try {
              await api.put("/settings/intent/classifyPrompt", { prompt: intentPrompt });
              setIntentIsCustom(true);
              setIntentSaved(true);
              setTimeout(() => setIntentSaved(false), 2000);
            } catch (err) {
              console.error("[pipeline] Failed to save intent prompt:", err);
            } finally {
              setIntentSaving(false);
            }
          }}
          disabled={intentSaving}
        >
          {intentSaving ? "Saving..." : intentSaved ? "Saved" : "Save Intent Prompt"}
        </Button>
        {intentIsCustom && (
          <Button
            variant="ghost"
            onClick={async () => {
              setIntentSaving(true);
              try {
                const res = await api.delete<{ prompt: string }>("/settings/intent/classifyPrompt");
                setIntentPrompt(res.prompt);
                setIntentIsCustom(false);
                setIntentSaved(false);
              } catch (err) {
                console.error("[pipeline] Failed to reset intent prompt:", err);
              } finally {
                setIntentSaving(false);
              }
            }}
            disabled={intentSaving}
            className="text-xs text-muted-foreground"
          >
            Reset to default
          </Button>
        )}
      </div>

      {/* Fail Signals section */}
      <hr className="border-border my-4" />
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
        Fail Signals
      </h4>
      <p className="text-[10px] text-muted-foreground/50 mb-2">
        Strings that trigger remediation when found in review agent output. One signal per line.
      </p>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="block text-sm font-medium text-muted-foreground">
            Fail Signal Patterns
          </label>
          {failSignalsIsCustom && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              custom
            </span>
          )}
        </div>
        <textarea
          value={failSignalsText}
          onChange={(e) => {
            setFailSignalsText(e.target.value);
            setFailSignalsIsCustom(e.target.value !== failSignalsDefaults.join("\n"));
          }}
          rows={6}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-y"
          placeholder={failSignalsDefaults.join("\n")}
        />
        <p className="text-xs text-muted-foreground/60 mt-1">
          {failSignalsDefaults.length} default signals. Case-insensitive matching.
        </p>
      </div>
      <div className="flex gap-2 mt-2">
        <Button
          onClick={async () => {
            setFailSignalsSaving(true);
            setFailSignalsSaved(false);
            try {
              const signals = failSignalsText.split("\n").filter((s) => s.trim());
              await api.put("/settings/pipeline/failSignals", { signals });
              setFailSignalsIsCustom(true);
              setFailSignalsSaved(true);
              setTimeout(() => setFailSignalsSaved(false), 2000);
            } catch (err) {
              console.error("[pipeline] Failed to save fail signals:", err);
            } finally {
              setFailSignalsSaving(false);
            }
          }}
          disabled={failSignalsSaving}
        >
          {failSignalsSaving ? "Saving..." : failSignalsSaved ? "Saved" : "Save Fail Signals"}
        </Button>
        {failSignalsIsCustom && (
          <Button
            variant="ghost"
            onClick={async () => {
              setFailSignalsSaving(true);
              try {
                const res = await api.delete<{ signals: string[] }>("/settings/pipeline/failSignals");
                setFailSignalsText(res.signals.join("\n"));
                setFailSignalsIsCustom(false);
                setFailSignalsSaved(false);
              } catch (err) {
                console.error("[pipeline] Failed to reset fail signals:", err);
              } finally {
                setFailSignalsSaving(false);
              }
            }}
            disabled={failSignalsSaving}
            className="text-xs text-muted-foreground"
          >
            Reset to default
          </Button>
        )}
      </div>
    </div>
  );
}
