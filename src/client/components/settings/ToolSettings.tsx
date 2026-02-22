import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { CustomToolSection } from "./CustomToolSection.tsx";
import type { AgentToolConfig, AgentGroup } from "../../../shared/types.ts";
import { BUILTIN_TOOL_NAMES } from "../../../shared/types.ts";
import type { CustomToolDefinition } from "../../../shared/custom-tool-types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
  custom: "Custom Agents",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality", "custom"];

function buildAgentGroups(configs: AgentToolConfig[]) {
  return GROUP_ORDER
    .map((g) => ({ label: GROUP_LABELS[g], agents: configs.filter((c) => c.group === g) }))
    .filter((g) => g.agents.length > 0);
}

const BUILTIN_TOOL_LABELS: Record<string, string> = {
  write_file: "Write File",
  write_files: "Write Files (Batch)",
  read_file: "Read File",
  list_files: "List Files",
  save_version: "Save Version",
};


export function ToolSettings() {
  const [configs, setConfigs] = useState<AgentToolConfig[]>([]);
  const [localTools, setLocalTools] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [customTools, setCustomTools] = useState<CustomToolDefinition[]>([]);

  const refresh = async () => {
    const [data, ct] = await Promise.all([
      api.get<AgentToolConfig[]>("/settings/agents/tools"),
      api.get<CustomToolDefinition[]>("/settings/custom-tools"),
    ]);
    setConfigs(data);
    setCustomTools(ct);
    const local: Record<string, string[]> = {};
    for (const c of data) {
      local[c.name] = [...c.tools];
    }
    setLocalTools(local);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  // All tool names: built-in + enabled custom
  const allToolNames = [
    ...BUILTIN_TOOL_NAMES,
    ...customTools.filter((t) => t.enabled).map((t) => t.name),
  ];

  function getToolLabel(toolName: string): string {
    if (BUILTIN_TOOL_LABELS[toolName]) return BUILTIN_TOOL_LABELS[toolName];
    const ct = customTools.find((t) => t.name === toolName);
    return ct?.displayName ?? toolName;
  }

  function toggleTool(agentName: string, tool: string) {
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
        Control which tools each agent can use during pipeline runs. Changes take effect on the next run.
      </p>

      {buildAgentGroups(configs).map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {group.agents.map((config) => {
              const agentName = config.name;
              const local = localTools[agentName] || [];
              const dirty = isDirty(agentName);

              return (
                <div
                  key={agentName}
                  className="rounded-lg bg-muted/50 border border-border/50 p-2.5"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-foreground">
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

                  <div className="flex gap-x-3 gap-y-1.5 flex-wrap">
                    {allToolNames.map((tool) => (
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
                        {getToolLabel(tool)}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <hr className="border-border" />

      <CustomToolSection />
    </div>
  );
}
