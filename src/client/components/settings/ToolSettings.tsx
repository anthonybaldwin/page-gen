import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { AgentToolConfig, ToolName } from "../../../shared/types.ts";

const AGENT_GROUPS: { label: string; agents: string[] }[] = [
  { label: "Planning", agents: ["orchestrator", "orchestrator:classify", "orchestrator:question", "orchestrator:summary", "research", "architect", "testing"] },
  { label: "Development", agents: ["frontend-dev", "backend-dev", "styling"] },
  { label: "Quality", agents: ["code-review", "qa", "security"] },
];

const TOOL_LABELS: Record<ToolName, string> = {
  write_file: "Write File",
  write_files: "Write Files (Batch)",
  read_file: "Read File",
  list_files: "List Files",
};

const ALL_TOOL_NAMES: ToolName[] = ["write_file", "write_files", "read_file", "list_files"];

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
    return <p className="text-sm text-zinc-500">Loading tool configs...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Control which native tools each agent can use during pipeline runs. Changes take effect on the next run.
      </p>

      {AGENT_GROUPS.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
            {group.agents.map((agentName) => {
              const config = configs.find((c) => c.name === agentName);
              if (!config) return null;
              const local = localTools[agentName] || [];
              const dirty = isDirty(agentName);

              return (
                <div
                  key={agentName}
                  className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {config.displayName}
                      </span>
                      {config.isOverridden && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
                          custom
                        </span>
                      )}
                      {config.isReadOnly && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-600/30 text-zinc-500">
                          no tools
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {config.isOverridden && (
                        <button
                          onClick={() => handleReset(agentName)}
                          disabled={saving === agentName}
                          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Reset
                        </button>
                      )}
                      {dirty && (
                        <button
                          onClick={() => handleSave(agentName)}
                          disabled={saving === agentName}
                          className="rounded px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors disabled:opacity-50"
                        >
                          {saving === agentName ? "..." : "Save"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    {ALL_TOOL_NAMES.map((tool) => (
                      <label
                        key={tool}
                        className={`flex items-center gap-1.5 text-xs ${
                          config.isReadOnly
                            ? "text-zinc-600 cursor-not-allowed"
                            : "text-zinc-300 cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={local.includes(tool)}
                          onChange={() => toggleTool(agentName, tool)}
                          disabled={config.isReadOnly}
                          className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 disabled:opacity-30"
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
