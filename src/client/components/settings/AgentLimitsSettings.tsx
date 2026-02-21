import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import type { AgentLimitsConfig, AgentGroup } from "../../../shared/types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality"];

function buildAgentGroups(configs: AgentLimitsConfig[]) {
  return GROUP_ORDER
    .map((g) => ({ label: GROUP_LABELS[g], agents: configs.filter((c) => c.group === g) }))
    .filter((g) => g.agents.length > 0);
}

interface LocalLimits {
  maxOutputTokens: number;
  maxToolSteps: number;
}

export function AgentLimitsSettings() {
  const [configs, setConfigs] = useState<AgentLimitsConfig[]>([]);
  const [localLimits, setLocalLimits] = useState<Record<string, LocalLimits>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = async () => {
    const data = await api.get<AgentLimitsConfig[]>("/settings/agents/limits");
    setConfigs(data);
    const local: Record<string, LocalLimits> = {};
    for (const c of data) {
      local[c.name] = { maxOutputTokens: c.maxOutputTokens, maxToolSteps: c.maxToolSteps };
    }
    setLocalLimits(local);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  function updateLimit(agentName: string, field: keyof LocalLimits, value: number) {
    setLocalLimits((prev) => {
      const current = prev[agentName];
      if (!current) return prev;
      return { ...prev, [agentName]: { ...current, [field]: value } as LocalLimits };
    });
  }

  function isDirty(agentName: string): boolean {
    const config = configs.find((c) => c.name === agentName);
    if (!config) return false;
    const local = localLimits[agentName];
    if (!local) return false;
    return local.maxOutputTokens !== config.maxOutputTokens || local.maxToolSteps !== config.maxToolSteps;
  }

  async function handleSave(agentName: string) {
    const local = localLimits[agentName];
    if (!local) return;
    setSaving(agentName);
    try {
      await api.put(`/settings/agents/${agentName}/limits`, {
        maxOutputTokens: local.maxOutputTokens,
        maxToolSteps: local.maxToolSteps,
      });
      await refresh();
    } catch (err) {
      console.error("[agent-limits] Save failed:", err);
    } finally {
      setSaving(null);
    }
  }

  async function handleReset(agentName: string) {
    setSaving(agentName);
    try {
      await api.delete(`/settings/agents/${agentName}/limits`);
      await refresh();
    } catch (err) {
      console.error("[agent-limits] Reset failed:", err);
    } finally {
      setSaving(null);
    }
  }

  if (configs.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading limit configs...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Control max output tokens and tool steps per agent. Changes take effect on the next run.
      </p>

      {buildAgentGroups(configs).map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
            {group.agents.map((config) => {
              const agentName = config.name;
              const local = localLimits[agentName];
              if (!local) return null;
              const dirty = isDirty(agentName);

              return (
                <div
                  key={agentName}
                  className="rounded-lg bg-muted/50 border border-border/50 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {config.displayName}
                      </span>
                      {config.isOverridden && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                          custom
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {config.isOverridden && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReset(agentName)}
                          disabled={saving === agentName}
                          className="h-6 px-2 text-xs text-muted-foreground"
                        >
                          Reset
                        </Button>
                      )}
                      {dirty && (
                        <Button
                          size="sm"
                          onClick={() => handleSave(agentName)}
                          disabled={saving === agentName}
                          className="h-7 text-xs"
                        >
                          {saving === agentName ? "..." : "Save"}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Max Output Tokens
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={local.maxOutputTokens}
                        onChange={(e) => updateLimit(agentName, "maxOutputTokens", Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                      <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                        Default: {config.defaultMaxOutputTokens.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        Max Tool Steps
                      </label>
                      <Input
                        type="number"
                        min={1}
                        value={local.maxToolSteps}
                        onChange={(e) => updateLimit(agentName, "maxToolSteps", Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                      <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
                        Default: {config.defaultMaxToolSteps}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
