import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import type { AgentToolConfig, ToolName, AgentGroup } from "../../../shared/types.ts";
import { ALL_TOOLS } from "../../../shared/types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality"];

function buildAgentGroups(configs: AgentToolConfig[]) {
  return GROUP_ORDER
    .map((g) => ({ label: GROUP_LABELS[g], agents: configs.filter((c) => c.group === g) }))
    .filter((g) => g.agents.length > 0);
}

const TOOL_LABELS: Record<ToolName, string> = {
  write_file: "Write File",
  write_files: "Write Files (Batch)",
  read_file: "Read File",
  list_files: "List Files",
  save_version: "Save Version",
};


export function ToolSettings() {
  const [configs, setConfigs] = useState<AgentToolConfig[]>([]);
  const [localTools, setLocalTools] = useState<Record<string, ToolName[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = async () => {
    const data = await api.get<AgentToolConfig[]>("/settings/agents/tools");
    setConfigs(data);
    const local: Record<string, ToolName[]> = {};
    for (const c of data) {
      local[c.name] = [...c.tools];
    }
    setLocalTools(local);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  function toggleTool(agentName: string, tool: ToolName) {
    setLocalTools((prev) => {
      const current = prev[agentName] || [];
      const next = current.includes(tool)
        ? current.filter((t) => t !== tool)
        : [...current, tool];
      return { ...prev, [agentName]: next };
    });
  }

  function isDirty(agentName: string): boolean {
    const config = configs.find((c) => c.name === agentName);
    if (!config) return false;
    const local = localTools[agentName] || [];
    if (local.length !== config.tools.length) return true;
    return !local.every((t) => config.tools.includes(t));
  }

  async function handleSave(agentName: string) {
    setSaving(agentName);
    try {
      await api.put(`/settings/agents/${agentName}/tools`, {
        tools: localTools[agentName] || [],
      });
      await refresh();
    } catch (err) {
      console.error("[tool-settings] Save failed:", err);
    } finally {
      setSaving(null);
    }
  }

  async function handleReset(agentName: string) {
    setSaving(agentName);
    try {
      await api.delete(`/settings/agents/${agentName}/tools`);
      await refresh();
    } catch (err) {
      console.error("[tool-settings] Reset failed:", err);
    } finally {
      setSaving(null);
    }
  }

  if (configs.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading tool configs...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Control which native tools each agent can use during pipeline runs. Changes take effect on the next run.
      </p>

      {buildAgentGroups(configs).map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
            {group.agents.map((config) => {
              const agentName = config.name;
              const local = localTools[agentName] || [];
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
                      {config.isReadOnly && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          no tools
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

                  <div className="flex gap-4">
                    {ALL_TOOLS.map((tool) => (
                      <label
                        key={tool}
                        className={`flex items-center gap-1.5 text-xs ${
                          config.isReadOnly
                            ? "text-muted-foreground/50 cursor-not-allowed"
                            : "text-muted-foreground cursor-pointer"
                        }`}
                      >
                        <Checkbox
                          checked={local.includes(tool)}
                          onCheckedChange={() => toggleTool(agentName, tool)}
                          disabled={config.isReadOnly}
                        />
                        {TOOL_LABELS[tool]}
                      </label>
                    ))}
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
