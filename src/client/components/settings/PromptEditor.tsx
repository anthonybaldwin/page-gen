import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { ResolvedAgentConfig } from "../../../shared/types.ts";

const AGENT_NAMES = [
  "orchestrator", "research", "architect",
  "frontend-dev", "backend-dev", "styling",
  "testing", "code-review", "qa", "security",
] as const;

export function PromptEditor() {
  const [configs, setConfigs] = useState<ResolvedAgentConfig[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("orchestrator");
  const [prompt, setPrompt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load agent configs for badge display
  useEffect(() => {
    api.get<ResolvedAgentConfig[]>("/settings/agents").then(setConfigs).catch(console.error);
  }, []);

  // Load prompt when agent changes
  useEffect(() => {
    setLoading(true);
    setSaved(false);
    api
      .get<{ prompt: string; isCustom: boolean }>(`/settings/agents/${selectedAgent}/prompt`)
      .then((res) => {
        setPrompt(res.prompt);
        setIsCustom(res.isCustom);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedAgent]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api.put(`/settings/agents/${selectedAgent}/prompt`, { prompt });
      setIsCustom(true);
      setSaved(true);
      // Refresh configs to update isOverridden badges
      const updated = await api.get<ResolvedAgentConfig[]>("/settings/agents");
      setConfigs(updated);
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
      await api.delete(`/settings/agents/${selectedAgent}/overrides`);
      // Reload prompt (will get file default)
      const res = await api.get<{ prompt: string; isCustom: boolean }>(`/settings/agents/${selectedAgent}/prompt`);
      setPrompt(res.prompt);
      setIsCustom(res.isCustom);
      const updated = await api.get<ResolvedAgentConfig[]>("/settings/agents");
      setConfigs(updated);
    } catch (err) {
      console.error("[prompt-editor] Reset failed:", err);
    } finally {
      setSaving(false);
    }
  }

  const selectedConfig = configs.find((c) => c.name === selectedAgent);

  return (
    <div className="flex gap-3 h-full min-h-[400px]">
      {/* Agent list sidebar */}
      <div className="w-40 shrink-0 space-y-0.5">
        <p className="text-xs text-zinc-500 mb-2">Agents</p>
        {AGENT_NAMES.map((name) => {
          const config = configs.find((c) => c.name === name);
          const hasCustomPrompt = config?.isOverridden;
          return (
            <button
              key={name}
              onClick={() => setSelectedAgent(name)}
              className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                selectedAgent === name
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <span className="truncate flex-1">{config?.displayName || name}</span>
              {hasCustomPrompt && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Prompt editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {selectedConfig?.displayName || selectedAgent}
            </span>
            {isCustom && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                custom
              </span>
            )}
          </div>
          {isCustom && (
            <button
              onClick={handleReset}
              disabled={saving}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Reset to default
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
            Loading...
          </div>
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 font-mono resize-none focus:outline-none focus:border-blue-500 leading-relaxed"
            spellCheck={false}
          />
        )}

        <div className="flex justify-end mt-2">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save Prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}
