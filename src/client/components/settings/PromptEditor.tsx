import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import type { ResolvedAgentConfig, AgentGroup } from "../../../shared/types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality"];

export function PromptEditor() {
  const [configs, setConfigs] = useState<ResolvedAgentConfig[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>("orchestrator");
  const [prompt, setPrompt] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<ResolvedAgentConfig[]>("/settings/agents").then(setConfigs).catch(console.error);
  }, []);

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
      <div className="w-40 shrink-0 space-y-2">
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
                  onClick={() => setSelectedAgent(config.name)}
                  className={`w-full justify-start px-2 py-1.5 h-auto text-xs ${
                    selectedAgent === config.name
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
      </div>

      {/* Prompt editor */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {selectedConfig?.displayName || selectedAgent}
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

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Loading...
          </div>
        ) : (
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 font-mono text-xs resize-none leading-relaxed"
            spellCheck={false}
          />
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
