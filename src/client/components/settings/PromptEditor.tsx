import { useEffect, useState, useMemo } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { getNordExtensions } from "../../lib/nordTheme.ts";
import { useThemeStore } from "../../stores/themeStore.ts";
import type { ResolvedAgentConfig, AgentGroup } from "../../../shared/types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
  custom: "Custom Agents",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality", "custom"];

/** Action prompt entries — these are NOT agents, but action kinds with editable prompts. */
const ACTION_PROMPT_ENTRIES = [
  { key: "action:summary", label: "Summary (success)" },
  { key: "action:summary-failed", label: "Summary (failed)" },
  { key: "action:mood-analysis", label: "Mood Analysis" },
] as const;

/** Pipeline base prompt entries — per-intent base prompts prepended to every agent's system prompt. */
const PIPELINE_PROMPT_ENTRIES = [
  { key: "pipeline:build", label: "Build Pipeline" },
  { key: "pipeline:fix", label: "Fix Pipeline" },
  { key: "pipeline:question", label: "Question Pipeline" },
] as const;

/** Check if a selected item is an action prompt (not an agent). */
function isActionPrompt(key: string): boolean {
  return key.startsWith("action:");
}

/** Check if a selected item is a pipeline base prompt. */
function isPipelinePrompt(key: string): boolean {
  return key.startsWith("pipeline:");
}

/** Extract the action kind from a selection key, e.g. "action:summary" → "summary". */
function getActionKind(key: string): string {
  return key.replace("action:", "");
}

/** Extract the intent from a pipeline prompt key, e.g. "pipeline:build" → "build". */
function getPipelineIntent(key: string): string {
  return key.replace("pipeline:", "");
}

export function PromptEditor() {
  const [configs, setConfigs] = useState<ResolvedAgentConfig[]>([]);
  const [selectedItem, setSelectedItem] = useState<string>("orchestrator");
  const [prompt, setPrompt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Track which action/pipeline prompts have custom overrides
  const [actionCustomMap, setActionCustomMap] = useState<Record<string, boolean>>({});
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  const extensions = useMemo(() => [
    ...getNordExtensions(resolvedTheme === "dark"),
    markdown(),
    EditorView.lineWrapping,
  ], [resolvedTheme]);

  useEffect(() => {
    api.get<ResolvedAgentConfig[]>("/settings/agents").then(setConfigs).catch(console.error);
    // Fetch custom status for all action prompts
    for (const entry of ACTION_PROMPT_ENTRIES) {
      const kind = getActionKind(entry.key);
      api.get<{ isCustom: boolean }>(`/settings/actions/${kind}/prompt`)
        .then((res) => setActionCustomMap((prev) => ({ ...prev, [entry.key]: res.isCustom })))
        .catch((err) => console.warn(`[prompts] Failed to fetch custom status for ${entry.key}:`, err));
    }
    // Fetch custom status for all pipeline base prompts
    for (const entry of PIPELINE_PROMPT_ENTRIES) {
      const intent = getPipelineIntent(entry.key);
      api.get<{ isCustom: boolean }>(`/settings/pipeline/basePrompt/${intent}`)
        .then((res) => setActionCustomMap((prev) => ({ ...prev, [entry.key]: res.isCustom })))
        .catch((err) => console.warn(`[prompts] Failed to fetch custom status for ${entry.key}:`, err));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setSaved(false);
    if (isPipelinePrompt(selectedItem)) {
      const intent = getPipelineIntent(selectedItem);
      api.get<{ prompt: string; isCustom: boolean }>(`/settings/pipeline/basePrompt/${intent}`)
        .then((res) => { setPrompt(res.prompt); setIsCustom(res.isCustom); })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else if (isActionPrompt(selectedItem)) {
      const kind = getActionKind(selectedItem);
      api.get<{ prompt: string; isCustom: boolean }>(`/settings/actions/${kind}/prompt`)
        .then((res) => { setPrompt(res.prompt); setIsCustom(res.isCustom); })
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      api.get<{ prompt: string; isCustom: boolean }>(`/settings/agents/${selectedItem}/prompt`)
        .then((res) => { setPrompt(res.prompt); setIsCustom(res.isCustom); })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [selectedItem]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      if (isPipelinePrompt(selectedItem)) {
        const intent = getPipelineIntent(selectedItem);
        await api.put(`/settings/pipeline/basePrompt/${intent}`, { prompt });
        setIsCustom(true);
        setActionCustomMap((prev) => ({ ...prev, [selectedItem]: true }));
      } else if (isActionPrompt(selectedItem)) {
        const kind = getActionKind(selectedItem);
        await api.put(`/settings/actions/${kind}/prompt`, { prompt });
        setIsCustom(true);
        setActionCustomMap((prev) => ({ ...prev, [selectedItem]: true }));
      } else {
        await api.put(`/settings/agents/${selectedItem}/prompt`, { prompt });
        setIsCustom(true);
        const updated = await api.get<ResolvedAgentConfig[]>("/settings/agents");
        setConfigs(updated);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[prompt-editor] Save failed:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    try {
      if (isPipelinePrompt(selectedItem)) {
        const intent = getPipelineIntent(selectedItem);
        await api.delete(`/settings/pipeline/basePrompt/${intent}`);
        const res = await api.get<{ prompt: string; isCustom: boolean }>(`/settings/pipeline/basePrompt/${intent}`);
        setPrompt(res.prompt);
        setIsCustom(res.isCustom);
        setActionCustomMap((prev) => ({ ...prev, [selectedItem]: res.isCustom }));
      } else if (isActionPrompt(selectedItem)) {
        const kind = getActionKind(selectedItem);
        await api.delete(`/settings/actions/${kind}/prompt`);
        const res = await api.get<{ prompt: string; isCustom: boolean }>(`/settings/actions/${kind}/prompt`);
        setPrompt(res.prompt);
        setIsCustom(res.isCustom);
        setActionCustomMap((prev) => ({ ...prev, [selectedItem]: res.isCustom }));
      } else {
        await api.delete(`/settings/agents/${selectedItem}/prompt`);
        const res = await api.get<{ prompt: string; isCustom: boolean }>(`/settings/agents/${selectedItem}/prompt`);
        setPrompt(res.prompt);
        setIsCustom(res.isCustom);
        const updated = await api.get<ResolvedAgentConfig[]>("/settings/agents");
        setConfigs(updated);
      }
    } catch (err) {
      console.error("[prompt-editor] Reset failed:", err);
    } finally {
      setSaving(false);
    }
  }

  const selectedConfig = configs.find((c) => c.name === selectedItem);
  const displayName = isPipelinePrompt(selectedItem)
    ? PIPELINE_PROMPT_ENTRIES.find((e) => e.key === selectedItem)?.label ?? selectedItem
    : isActionPrompt(selectedItem)
      ? ACTION_PROMPT_ENTRIES.find((e) => e.key === selectedItem)?.label ?? selectedItem
      : selectedConfig?.displayName || selectedItem;

  return (
    <div className="flex gap-3 flex-1 min-h-0">
      {/* Agent + action list sidebar */}
      <div className="w-40 shrink-0 space-y-2 overflow-y-auto">
        {GROUP_ORDER.map((group) => {
          const groupConfigs = configs.filter((c) => c.group === group);
          if (groupConfigs.length === 0) return null;
          return (
            <div key={group}>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 mb-0.5">
                {GROUP_LABELS[group]}
              </p>
              {groupConfigs.map((config) => (
                <Button
                  key={config.name}
                  variant="ghost"
                  onClick={() => setSelectedItem(config.name)}
                  className={`w-full justify-start px-2 py-1.5 h-auto text-xs ${
                    selectedItem === config.name
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span className="truncate flex-1 text-left">{config.displayName}</span>
                  {config.isOverridden && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  )}
                </Button>
              ))}
            </div>
          );
        })}
        {/* Pipeline Base Prompts group */}
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 mb-0.5">
            Pipeline Base Prompts
          </p>
          {PIPELINE_PROMPT_ENTRIES.map((entry) => (
            <Button
              key={entry.key}
              variant="ghost"
              onClick={() => setSelectedItem(entry.key)}
              className={`w-full justify-start px-2 py-1.5 h-auto text-xs ${
                selectedItem === entry.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="truncate flex-1 text-left">{entry.label}</span>
              {actionCustomMap[entry.key] && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
            </Button>
          ))}
        </div>
        {/* Action Prompts group */}
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 mb-0.5">
            Action Prompts
          </p>
          {ACTION_PROMPT_ENTRIES.map((entry) => (
            <Button
              key={entry.key}
              variant="ghost"
              onClick={() => setSelectedItem(entry.key)}
              className={`w-full justify-start px-2 py-1.5 h-auto text-xs ${
                selectedItem === entry.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="truncate flex-1 text-left">{entry.label}</span>
              {actionCustomMap[entry.key] && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
            </Button>
          ))}
        </div>
      </div>

      {/* Prompt editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {displayName}
            </span>
            {isCustom && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                custom
              </span>
            )}
          </div>
          {isCustom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={saving}
              className="h-6 px-2 text-xs text-muted-foreground"
            >
              Reset to default
            </Button>
          )}
        </div>
        {isPipelinePrompt(selectedItem) && (
          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
            Prepended to every agent's system prompt in this pipeline. Individual agent nodes can override with their own system prompt.
          </p>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden rounded">
            <CodeMirror
              value={prompt}
              onChange={setPrompt}
              extensions={extensions}
              theme="none"
              className="h-full text-xs"
              height="100%"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                bracketMatching: true,
                closeBrackets: true,
                tabSize: 2,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
              }}
            />
          </div>
        )}

        <div className="flex justify-end mt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save Prompt"}
          </Button>
        </div>
      </div>
    </div>
  );
}
