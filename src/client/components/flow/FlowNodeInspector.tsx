import { useState, useEffect, useCallback, useMemo } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import { api } from "../../lib/api.ts";
import type { FlowNode, FlowEdge, FlowNodeData, AgentNodeData, ConditionNodeData, CheckpointNodeData, ActionNodeData, VersionNodeData, UpstreamSource, UpstreamTransform, ActionKind } from "../../../shared/flow-types.ts";
import { PREDEFINED_CONDITIONS, UPSTREAM_TRANSFORMS, WELL_KNOWN_SOURCES } from "../../../shared/flow-types.ts";
import { BUILTIN_TOOL_NAMES } from "../../../shared/types.ts";
import type { PipelineConfig } from "../settings/PipelineSettings.tsx";

interface FlowNodeInspectorProps {
  node: FlowNode | null;
  agentNames: string[];
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
  pipelineDefaults?: PipelineConfig | null;
}

/** Compute ancestor node IDs by walking backwards through edges */
function getAncestorNodeIds(nodeId: string, allNodes: FlowNode[], allEdges: FlowEdge[]): string[] {
  const inEdges = new Map<string, string[]>();
  for (const edge of allEdges) {
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    inEdges.get(edge.target)!.push(edge.source);
  }
  const ancestors = new Set<string>();
  const queue = [...(inEdges.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    queue.push(...(inEdges.get(id) ?? []));
  }
  return [...ancestors];
}

/** Get available source keys for a node (ancestors + well-known sources) */
function getAvailableSourceKeys(nodeId: string, allNodes: FlowNode[], allEdges: FlowEdge[]): string[] {
  const ancestors = getAncestorNodeIds(nodeId, allNodes, allEdges);
  const wellKnown = WELL_KNOWN_SOURCES as readonly string[];
  const all = new Set([...ancestors, ...wellKnown]);
  return [...all].sort();
}

export function FlowNodeInspector({ node, agentNames, allNodes, allEdges, onUpdate, onDelete, pipelineDefaults }: FlowNodeInspectorProps) {
  if (!node) return null;

  return (
    <div className="space-y-3 p-3 border-l border-border min-w-[260px] max-w-[300px] overflow-y-auto">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-foreground uppercase tracking-wider">
          {node.data.type} Node
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(node.id)}
          className="h-6 px-2 text-xs text-destructive hover:text-destructive"
        >
          Delete
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground font-mono">{node.id}</div>

      {node.data.type === "agent" && (
        <AgentInspector data={node.data} nodeId={node.id} agentNames={agentNames} allNodes={allNodes} allEdges={allEdges} onUpdate={onUpdate} pipelineDefaults={pipelineDefaults} />
      )}
      {node.data.type === "condition" && (
        <ConditionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
      {node.data.type === "checkpoint" && (
        <CheckpointInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
      {node.data.type === "action" && (
        <ActionInspector data={node.data} nodeId={node.id} agentNames={agentNames} onUpdate={onUpdate} />
      )}
      {node.data.type === "version" && (
        <VersionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
    </div>
  );
}

const GENERIC_PROMPT = "Original request: {{userMessage}}";

// --- Upstream Sources Editor ---

function UpstreamSourcesEditor({ sources, nodeId, allNodes, allEdges, onChange }: {
  sources: UpstreamSource[];
  nodeId: string;
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onChange: (sources: UpstreamSource[]) => void;
}) {
  const availableKeys = useMemo(() => getAvailableSourceKeys(nodeId, allNodes, allEdges), [nodeId, allNodes, allEdges]);

  const handleAdd = () => {
    const firstAvailable = availableKeys.find(k => !sources.some(s => s.sourceKey === k && !s.alias));
    onChange([...sources, { sourceKey: firstAvailable ?? availableKeys[0] ?? "" }]);
  };

  const handleRemove = (index: number) => {
    onChange(sources.filter((_, i) => i !== index));
  };

  const handleUpdate = (index: number, updated: UpstreamSource) => {
    const next = [...sources];
    next[index] = updated;
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      {sources.map((source, i) => (
        <div key={i} className="flex items-center gap-1 text-xs">
          <select
            value={source.sourceKey}
            onChange={(e) => handleUpdate(i, { ...source, sourceKey: e.target.value })}
            className="flex-1 min-w-0 rounded border border-border bg-background px-1 py-0.5 text-[11px]"
          >
            {availableKeys.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
          <select
            value={source.transform ?? "raw"}
            onChange={(e) => handleUpdate(i, { ...source, transform: (e.target.value === "raw" ? undefined : e.target.value) as UpstreamTransform | undefined })}
            className="w-[90px] rounded border border-border bg-background px-1 py-0.5 text-[11px]"
          >
            {UPSTREAM_TRANSFORMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="text"
            value={source.alias ?? ""}
            onChange={(e) => handleUpdate(i, { ...source, alias: e.target.value || undefined })}
            placeholder="alias"
            className="w-[60px] rounded border border-border bg-background px-1 py-0.5 text-[11px]"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            className="text-destructive hover:text-destructive/80 text-sm px-0.5"
            title="Remove source"
          >
            x
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={handleAdd}
        className="text-[11px] text-primary hover:text-primary/80"
      >
        + Add Source
      </button>
    </div>
  );
}

// --- Merge Field Pills ---

function MergeFieldPills({ sources, onInsert }: {
  sources: UpstreamSource[];
  onInsert: (field: string) => void;
}) {
  if (sources.length === 0) return null;

  const fields = sources.map((s) => {
    const key = s.alias ?? s.sourceKey;
    return `{{output:${key}}}`;
  });
  // Deduplicate
  const unique = [...new Set(fields)];

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {unique.map((field) => (
        <button
          key={field}
          type="button"
          onClick={() => onInsert(field)}
          className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 font-mono"
          title={`Click to insert ${field}`}
        >
          {field}
        </button>
      ))}
    </div>
  );
}

// --- Agent Inspector ---

function AgentInspector({ data, nodeId, agentNames, allNodes, allEdges, onUpdate, pipelineDefaults }: {
  data: AgentNodeData;
  nodeId: string;
  agentNames: string[];
  allNodes: FlowNode[];
  allEdges: FlowEdge[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  pipelineDefaults?: PipelineConfig | null;
}) {
  const [agentName, setAgentName] = useState(data.agentName);
  const [inputTemplate, setInputTemplate] = useState(data.inputTemplate);
  const [maxOutputTokens, setMaxOutputTokens] = useState(data.maxOutputTokens?.toString() ?? "");
  const [maxToolSteps, setMaxToolSteps] = useState(data.maxToolSteps?.toString() ?? "");
  const [agentDefaultPrompt, setAgentDefaultPrompt] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(!!data.upstreamSources);
  const [upstreamSources, setUpstreamSources] = useState<UpstreamSource[]>(data.upstreamSources ?? []);
  const [showToolOverrides, setShowToolOverrides] = useState(!!data.toolOverrides);
  const [toolOverrides, setToolOverrides] = useState<string[]>(data.toolOverrides ?? [...BUILTIN_TOOL_NAMES]);
  const [useCustomSystemPrompt, setUseCustomSystemPrompt] = useState(!!data.systemPrompt);
  const [systemPrompt, setSystemPrompt] = useState(data.systemPrompt ?? "");
  const [agentSystemPromptDefault, setAgentSystemPromptDefault] = useState<string | null>(null);

  useEffect(() => {
    setAgentName(data.agentName);
    setInputTemplate(data.inputTemplate);
    setMaxOutputTokens(data.maxOutputTokens?.toString() ?? "");
    setMaxToolSteps(data.maxToolSteps?.toString() ?? "");
    setUpstreamSources(data.upstreamSources ?? []);
    setShowSources(!!data.upstreamSources);
    setShowToolOverrides(!!data.toolOverrides);
    setToolOverrides(data.toolOverrides ?? [...BUILTIN_TOOL_NAMES]);
    setUseCustomSystemPrompt(!!data.systemPrompt);
    setSystemPrompt(data.systemPrompt ?? "");
  }, [data]);

  // Fetch default input prompt when agent name is set
  useEffect(() => {
    if (!agentName) {
      setAgentDefaultPrompt(null);
      return;
    }
    api
      .get<{ defaultPrompt: string; isCustom: boolean }>(`/settings/agents/${agentName}/defaultPrompt`)
      .then((res) => setAgentDefaultPrompt(res.defaultPrompt))
      .catch(() => setAgentDefaultPrompt(null));
  }, [agentName]);

  // Fetch system prompt default when agent name is set
  useEffect(() => {
    if (!agentName) {
      setAgentSystemPromptDefault(null);
      return;
    }
    api
      .get<{ prompt: string; isCustom: boolean }>(`/settings/agents/${agentName}/prompt`)
      .then((res) => setAgentSystemPromptDefault(res.prompt))
      .catch(() => setAgentSystemPromptDefault(null));
  }, [agentName]);

  const buildData = useCallback(
    (overrides?: Partial<AgentNodeData>): AgentNodeData => ({
      ...data,
      agentName,
      inputTemplate,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
      upstreamSources: showSources ? upstreamSources : undefined,
      toolOverrides: showToolOverrides ? toolOverrides : undefined,
      systemPrompt: useCustomSystemPrompt && systemPrompt ? systemPrompt : undefined,
      ...overrides,
    }),
    [data, agentName, inputTemplate, maxOutputTokens, maxToolSteps, upstreamSources, showSources, toolOverrides, showToolOverrides, useCustomSystemPrompt, systemPrompt],
  );

  const save = useCallback(() => {
    onUpdate(nodeId, buildData());
  }, [nodeId, buildData, onUpdate]);

  const handleAgentChange = useCallback((newAgentName: string) => {
    setAgentName(newAgentName);
    if (!newAgentName) return;

    api
      .get<{ defaultPrompt: string; isCustom: boolean }>(`/settings/agents/${newAgentName}/defaultPrompt`)
      .then((res) => {
        setAgentDefaultPrompt(res.defaultPrompt);
        const currentIsGenericOrEmpty =
          !inputTemplate || inputTemplate === GENERIC_PROMPT || inputTemplate === "{{userMessage}}";
        if (currentIsGenericOrEmpty) {
          setInputTemplate(res.defaultPrompt);
          onUpdate(nodeId, buildData({ agentName: newAgentName, inputTemplate: res.defaultPrompt }));
        } else {
          onUpdate(nodeId, buildData({ agentName: newAgentName }));
        }
      })
      .catch(() => {
        setAgentDefaultPrompt(null);
        onUpdate(nodeId, buildData({ agentName: newAgentName }));
      });
  }, [inputTemplate, nodeId, buildData, onUpdate]);

  const handleResetToDefault = useCallback(() => {
    if (agentDefaultPrompt) {
      setInputTemplate(agentDefaultPrompt);
      onUpdate(nodeId, buildData({ inputTemplate: agentDefaultPrompt }));
    }
  }, [agentDefaultPrompt, nodeId, buildData, onUpdate]);

  const handleSourcesChange = useCallback((newSources: UpstreamSource[]) => {
    setUpstreamSources(newSources);
    onUpdate(nodeId, buildData({ upstreamSources: newSources }));
  }, [nodeId, buildData, onUpdate]);

  const handleToggleSources = useCallback((enabled: boolean) => {
    setShowSources(enabled);
    if (enabled) {
      onUpdate(nodeId, buildData({ upstreamSources: upstreamSources }));
    } else {
      onUpdate(nodeId, buildData({ upstreamSources: undefined }));
    }
  }, [nodeId, upstreamSources, buildData, onUpdate]);

  const handleInsertMergeField = useCallback((field: string) => {
    setInputTemplate((prev) => prev + " " + field);
    // Don't auto-save here — user should review and blur to save
  }, []);

  const handleToggleToolOverrides = useCallback((enabled: boolean) => {
    setShowToolOverrides(enabled);
    if (enabled) {
      // Initialize from global agent tools when enabling
      if (agentName) {
        api
          .get<{ tools: string[] }>(`/settings/agents/${agentName}/tools`)
          .then((res) => {
            setToolOverrides(res.tools);
            onUpdate(nodeId, buildData({ toolOverrides: res.tools }));
          })
          .catch(() => {
            const defaults = [...BUILTIN_TOOL_NAMES];
            setToolOverrides(defaults);
            onUpdate(nodeId, buildData({ toolOverrides: defaults }));
          });
      } else {
        const defaults = [...BUILTIN_TOOL_NAMES];
        setToolOverrides(defaults);
        onUpdate(nodeId, buildData({ toolOverrides: defaults }));
      }
    } else {
      onUpdate(nodeId, buildData({ toolOverrides: undefined }));
    }
  }, [agentName, nodeId, buildData, onUpdate]);

  const handleToolToggle = useCallback((toolName: string, enabled: boolean) => {
    const next = enabled
      ? [...toolOverrides, toolName]
      : toolOverrides.filter((t) => t !== toolName);
    setToolOverrides(next);
    onUpdate(nodeId, buildData({ toolOverrides: next }));
  }, [toolOverrides, nodeId, buildData, onUpdate]);

  const isUsingDefault = agentDefaultPrompt !== null && inputTemplate === agentDefaultPrompt;
  const isCustomized = agentDefaultPrompt !== null && inputTemplate !== agentDefaultPrompt;

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Agent</span>
        <select
          value={agentName}
          onChange={(e) => handleAgentChange(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Select agent...</option>
          {agentNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>

      {/* System Prompt section */}
      <div className="border-t border-border pt-2 mt-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">System Prompt</span>
            {useCustomSystemPrompt && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary">
                custom
              </span>
            )}
          </div>
          {useCustomSystemPrompt && (
            <button
              type="button"
              onClick={() => {
                setUseCustomSystemPrompt(false);
                setSystemPrompt("");
                onUpdate(nodeId, buildData({ systemPrompt: undefined }));
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Reset to default
            </button>
          )}
        </div>
        {useCustomSystemPrompt ? (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            onBlur={save}
            rows={5}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y"
            placeholder="Enter custom system prompt..."
          />
        ) : (
          <div
            className="flex items-center justify-between text-[10px] text-muted-foreground italic cursor-pointer hover:text-foreground rounded border border-transparent hover:border-border px-1 py-0.5"
            onClick={() => {
              setUseCustomSystemPrompt(true);
              if (agentSystemPromptDefault) {
                setSystemPrompt(agentSystemPromptDefault);
              }
            }}
          >
            <span>Using agent default system prompt</span>
            <span className="text-primary/60">Customize</span>
          </div>
        )}
      </div>

      {/* Data Sources section */}
      <div className="border-t border-border pt-2 mt-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Data Sources</span>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showSources}
              onChange={(e) => handleToggleSources(e.target.checked)}
              className="rounded border-border h-3 w-3"
            />
            <span className="text-[10px] text-muted-foreground">Customize</span>
          </label>
        </div>
        {showSources ? (
          <UpstreamSourcesEditor
            sources={upstreamSources}
            nodeId={nodeId}
            allNodes={allNodes}
            allEdges={allEdges}
            onChange={handleSourcesChange}
          />
        ) : (
          <div className="text-[10px] text-muted-foreground italic">
            Using default data routing
          </div>
        )}
      </div>

      {/* Prompt section */}
      <label className="block">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Prompt</span>
            {isCustomized && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary">
                custom
              </span>
            )}
          </div>
          {isCustomized && (
            <button
              type="button"
              onClick={handleResetToDefault}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Reset to default
            </button>
          )}
        </div>
        <textarea
          value={inputTemplate}
          onChange={(e) => setInputTemplate(e.target.value)}
          onBlur={save}
          rows={4}
          className={`mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y ${
            isUsingDefault ? "italic text-muted-foreground" : "font-medium"
          }`}
          placeholder="Use {{userMessage}} for the user's request"
        />
        {showSources && upstreamSources.length > 0 && (
          <MergeFieldPills sources={upstreamSources} onInsert={handleInsertMergeField} />
        )}
      </label>

      {/* Output section */}
      <div className="border-t border-border pt-2 mt-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</span>
        <div className="text-[10px] text-muted-foreground mt-1">
          Output key: <span className="font-mono text-foreground">{nodeId}</span>
        </div>
      </div>

      {/* Overrides section */}
      <div className="border-t border-border pt-2 mt-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Overrides</span>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Max Output Tokens</span>
            <Input
              type="number"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              onBlur={save}
              className="mt-0.5 h-6 text-xs"
              placeholder={String(pipelineDefaults?.defaultMaxOutputTokens ?? 8192)}
              min={1}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Max Tool Steps</span>
            <Input
              type="number"
              value={maxToolSteps}
              onChange={(e) => setMaxToolSteps(e.target.value)}
              onBlur={save}
              className="mt-0.5 h-6 text-xs"
              placeholder={String(pipelineDefaults?.defaultMaxToolSteps ?? 10)}
              min={1}
            />
          </label>
        </div>
      </div>

      {/* Tool Overrides section */}
      <div className="border-t border-border pt-2 mt-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tools</span>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showToolOverrides}
              onChange={(e) => handleToggleToolOverrides(e.target.checked)}
              className="rounded border-border h-3 w-3"
            />
            <span className="text-[10px] text-muted-foreground">Override</span>
          </label>
        </div>
        {showToolOverrides ? (
          <div className="space-y-1">
            {BUILTIN_TOOL_NAMES.map((toolName) => (
              <label key={toolName} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={toolOverrides.includes(toolName)}
                  onChange={(e) => handleToolToggle(toolName, e.target.checked)}
                  className="rounded border-border h-3 w-3"
                />
                <span className="text-[11px] font-mono text-foreground">{toolName}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">
            Using global agent tools config
          </div>
        )}
      </div>
    </div>
  );
}

function ConditionInspector({ data, nodeId, onUpdate }: {
  data: ConditionNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [mode, setMode] = useState(data.mode);
  const [predefined, setPredefined] = useState(data.predefined ?? "");
  const [expression, setExpression] = useState(data.expression ?? "");
  const [label, setLabel] = useState(data.label);

  useEffect(() => {
    setMode(data.mode);
    setPredefined(data.predefined ?? "");
    setExpression(data.expression ?? "");
    setLabel(data.label);
  }, [data]);

  const save = () => {
    onUpdate(nodeId, { ...data, mode, predefined: predefined || undefined, expression: expression || undefined, label });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Mode</span>
        <select
          value={mode}
          onChange={(e) => { setMode(e.target.value as "predefined" | "expression"); }}
          onBlur={save}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="predefined">Predefined</option>
          <option value="expression">Advanced Expression</option>
        </select>
      </label>
      {mode === "predefined" && (
        <label className="block">
          <span className="text-xs text-muted-foreground">Condition</span>
          <select
            value={predefined}
            onChange={(e) => setPredefined(e.target.value)}
            onBlur={save}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">Select...</option>
            {PREDEFINED_CONDITIONS.map((cond) => (
              <option key={cond.id} value={cond.id}>{cond.label}</option>
            ))}
          </select>
        </label>
      )}
      {mode === "expression" && (
        <label className="block">
          <span className="text-xs text-muted-foreground">Expression</span>
          <Input
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onBlur={save}
            className="mt-1 h-7 text-xs font-mono"
            placeholder='scope === "backend"'
          />
        </label>
      )}
    </div>
  );
}

function CheckpointInspector({ data, nodeId, onUpdate }: {
  data: CheckpointNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [label, setLabel] = useState(data.label);
  const [skipInYolo, setSkipInYolo] = useState(data.skipInYolo);
  const [checkpointType, setCheckpointType] = useState(data.checkpointType ?? "approve");
  const [message, setMessage] = useState(data.message ?? "");
  const [timeoutMs, setTimeoutMs] = useState(data.timeoutMs?.toString() ?? "");

  useEffect(() => {
    setLabel(data.label);
    setSkipInYolo(data.skipInYolo);
    setCheckpointType(data.checkpointType ?? "approve");
    setMessage(data.message ?? "");
    setTimeoutMs(data.timeoutMs?.toString() ?? "");
  }, [data]);

  const save = () => {
    onUpdate(nodeId, {
      ...data,
      label,
      skipInYolo,
      checkpointType,
      message: message || undefined,
      timeoutMs: timeoutMs ? parseInt(timeoutMs) : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Checkpoint Type</span>
        <select
          value={checkpointType}
          onChange={(e) => { setCheckpointType(e.target.value as "approve" | "design_direction"); setTimeout(save, 0); }}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="approve">Approve / Continue</option>
          <option value="design_direction">Design Direction Choice</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Message</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onBlur={save}
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs resize-y"
          placeholder="Message shown to the user at this checkpoint"
        />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Timeout (ms)</span>
        <Input
          type="number"
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          onBlur={save}
          className="mt-1 h-7 text-xs"
          placeholder="600000 (10 min)"
          min={0}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={skipInYolo}
          onChange={(e) => { setSkipInYolo(e.target.checked); setTimeout(save, 0); }}
          className="rounded border-border"
        />
        <span className="text-xs text-muted-foreground">Skip in YOLO mode</span>
      </label>

      {/* Structured Input / Output */}
      {checkpointType === "design_direction" ? (
        <>
          <div className="border-t border-border pt-2 mt-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Input</span>
            <div className="mt-1">
              <code className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">{"{{output:architect}}"}</code>
            </div>
          </div>
          <div className="border-t border-border pt-2 mt-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</span>
            <div className="text-[10px] text-muted-foreground mt-1">
              Output key: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">design_system</code>
            </div>
          </div>
        </>
      ) : (
        <div className="border-t border-border pt-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Behavior</span>
          <div className="text-[10px] text-muted-foreground mt-1">
            Pauses the pipeline and waits for user approval before continuing. No input/output — pass-through only.
          </div>
        </div>
      )}
    </div>
  );
}

const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  "build-check": "Build Check",
  "test-run": "Test Run",
  "remediation": "Remediation",
  "summary": "Summary",
  "vibe-intake": "Vibe Brief",
  "mood-analysis": "Mood Analysis",
  "answer": "Answer",
  "shell": "Shell Command",
  "llm-call": "LLM Call",
};

const ALL_ACTION_KINDS = Object.keys(ACTION_KIND_LABELS) as ActionKind[];

const KIND_DESCRIPTIONS: Record<string, string> = {
  "build-check": "Runs the configured build command to verify the project compiles. If errors are found, a build-fix agent attempts to fix them (up to Max Attempts).",
  "test-run": "Runs the configured test command. If tests fail, a build-fix agent attempts to fix them and re-runs only the failed tests.",
  "remediation": "Reads outputs from connected review agents, detects issues via fail signals, routes fixes to configured dev agents, then re-runs affected reviewers. Repeats up to Max Cycles or until all issues resolve. Configure which agents handle fixes below.",
  "summary": "LLM call — generates a final summary of what was built, using all agent outputs. Adapts tone based on whether the build succeeded or had errors.",
  "vibe-intake": "Loads the project's vibe brief (adjectives, metaphor, target user) and injects it into the pipeline context. No LLM call.",
  "mood-analysis": "LLM call (vision) — analyzes uploaded mood board images and extracts color palette, style descriptors, and mood keywords as structured JSON.",
  "answer": "Relays the most recent agent output as the assistant chat message. No LLM call — just pass-through.",
  "shell": "Runs an arbitrary shell command in the project directory. Captures stdout as node output.",
  "llm-call": "Makes a custom LLM call with a user-defined system prompt and input template. Use {{variables}} for template substitution.",
};

/** Action kinds that make direct LLM calls and support system prompt / maxOutputTokens overrides */
const AGENTIC_KINDS = new Set(["summary", "mood-analysis", "llm-call"]);

/** Default max output tokens per agentic kind */
const KIND_DEFAULT_MAX_TOKENS: Record<string, number> = {
  "summary": 1024,
  "mood-analysis": 1000,
  "llm-call": 4096,
};

/** Human-readable description of what the default prompt does per kind */
const KIND_DEFAULT_PROMPT_LABEL: Record<string, string> = {
  "summary": "Built-in summary prompt (adapts for success/failure)",
  "mood-analysis": "Built-in vision prompt (extracts palette, style, mood as JSON)",
};

/** Which agent/model each action kind uses under the hood */
const KIND_AGENT_LABEL: Record<string, string> = {
  "summary": "orchestrator:summary",
  "mood-analysis": "Vision model (Sonnet / GPT-4o)",
  "build-check": "build-fix (on errors)",
  "test-run": "build-fix (on failures)",
  "remediation": "fix + review agents",
  "answer": "None (relays agent output)",
  "shell": "None (subprocess)",
  "llm-call": "Orchestrator model",
};

const KIND_IO: Record<string, { input: string; outputKey: string }> = {
  "build-check": { input: "Project files on disk", outputKey: "build-check" },
  "test-run": { input: "Project test files", outputKey: "test-run" },
  "remediation": { input: "Review agent outputs", outputKey: "remediation" },
  "summary": { input: "All agent outputs (truncated)", outputKey: "summary" },
  "vibe-intake": { input: "DB project vibe brief", outputKey: "vibe-brief" },
  "mood-analysis": { input: "Mood board images on disk", outputKey: "mood-analysis" },
  "answer": { input: "Previous agent output", outputKey: "answer" },
  "shell": { input: "Shell command", outputKey: "shell" },
  "llm-call": { input: "Rendered template + system prompt", outputKey: "llm-call" },
};

/** Which override fields to show per action kind */
const KIND_FIELDS: Record<string, Array<{ key: keyof ActionNodeData; label: string; placeholder: string }>> = {
  "build-check": [
    { key: "timeoutMs", label: "Timeout (ms)", placeholder: "30000" },
    { key: "maxAttempts", label: "Max Fix Attempts", placeholder: "3" },
    { key: "maxUniqueErrors", label: "Max Unique Errors", placeholder: "10" },
  ],
  "test-run": [
    { key: "timeoutMs", label: "Timeout (ms)", placeholder: "60000" },
    { key: "maxAttempts", label: "Max Fix Attempts", placeholder: "2" },
    { key: "maxTestFailures", label: "Max Test Failures", placeholder: "5" },
    { key: "maxUniqueErrors", label: "Max Unique Errors", placeholder: "10" },
  ],
  "remediation": [
    { key: "maxAttempts", label: "Max Cycles", placeholder: "2" },
  ],
  "shell": [
    { key: "timeoutMs", label: "Timeout (ms)", placeholder: "60000" },
  ],
};

function ActionInspector({ data, nodeId, agentNames, onUpdate }: {
  data: ActionNodeData;
  nodeId: string;
  agentNames: string[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [label, setLabel] = useState(data.label);
  const [overrides, setOverrides] = useState<Record<string, string>>({
    timeoutMs: data.timeoutMs?.toString() ?? "",
    maxAttempts: data.maxAttempts?.toString() ?? "",
    maxTestFailures: data.maxTestFailures?.toString() ?? "",
    maxUniqueErrors: data.maxUniqueErrors?.toString() ?? "",
  });
  // LLM config state (for agentic kinds)
  const [useCustomPrompt, setUseCustomPrompt] = useState(!!data.systemPrompt);
  const [systemPrompt, setSystemPrompt] = useState(data.systemPrompt ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(data.maxOutputTokens?.toString() ?? "");
  // Remediation config state
  const [remediationFixAgents, setRemediationFixAgents] = useState<string[]>(data.remediationFixAgents ?? []);
  const [remediationReviewerKeys, setRemediationReviewerKeys] = useState<string[]>(data.remediationReviewerKeys ?? []);
  const [useCustomFixAgents, setUseCustomFixAgents] = useState(!!data.remediationFixAgents);
  const [useCustomReviewerKeys, setUseCustomReviewerKeys] = useState(!!data.remediationReviewerKeys);
  // Build/test command state
  const [buildCommand, setBuildCommand] = useState(data.buildCommand ?? "");
  const [testCommand, setTestCommand] = useState(data.testCommand ?? "");
  // Fail signals state
  const [useCustomFailSignals, setUseCustomFailSignals] = useState(!!data.failSignals);
  const [failSignalsText, setFailSignalsText] = useState((data.failSignals ?? []).join("\n"));
  // Build-fix agent state
  const [buildFixAgent, setBuildFixAgent] = useState(data.buildFixAgent ?? "");
  // Shell action state
  const [shellCommand, setShellCommand] = useState(data.shellCommand ?? "");
  const [shellCaptureOutput, setShellCaptureOutput] = useState(data.shellCaptureOutput !== false);
  // LLM call action state
  const [llmInputTemplate, setLlmInputTemplate] = useState(data.llmInputTemplate ?? "");
  // Agent config state (for agentic kinds)
  const [agentConfig, setAgentConfig] = useState(data.agentConfig ?? "");
  // Default prompt viewing state (for agentic kinds)
  const [defaultPromptText, setDefaultPromptText] = useState<string | null>(null);
  const [showDefaultPrompt, setShowDefaultPrompt] = useState(false);

  const isAgentic = AGENTIC_KINDS.has(data.kind);
  const isRemediation = data.kind === "remediation";

  useEffect(() => {
    setLabel(data.label);
    setOverrides({
      timeoutMs: data.timeoutMs?.toString() ?? "",
      maxAttempts: data.maxAttempts?.toString() ?? "",
      maxTestFailures: data.maxTestFailures?.toString() ?? "",
      maxUniqueErrors: data.maxUniqueErrors?.toString() ?? "",
    });
    setUseCustomPrompt(!!data.systemPrompt);
    setSystemPrompt(data.systemPrompt ?? "");
    setMaxOutputTokens(data.maxOutputTokens?.toString() ?? "");
    setRemediationFixAgents(data.remediationFixAgents ?? []);
    setRemediationReviewerKeys(data.remediationReviewerKeys ?? []);
    setUseCustomFixAgents(!!data.remediationFixAgents);
    setUseCustomReviewerKeys(!!data.remediationReviewerKeys);
    setBuildCommand(data.buildCommand ?? "");
    setTestCommand(data.testCommand ?? "");
    setUseCustomFailSignals(!!data.failSignals);
    setFailSignalsText((data.failSignals ?? []).join("\n"));
    setBuildFixAgent(data.buildFixAgent ?? "");
    setShellCommand(data.shellCommand ?? "");
    setShellCaptureOutput(data.shellCaptureOutput !== false);
    setLlmInputTemplate(data.llmInputTemplate ?? "");
    setAgentConfig(data.agentConfig ?? "");
  }, [data]);

  const save = useCallback(() => {
    onUpdate(nodeId, {
      ...data,
      label,
      timeoutMs: overrides.timeoutMs ? parseInt(overrides.timeoutMs) : undefined,
      maxAttempts: overrides.maxAttempts ? parseInt(overrides.maxAttempts) : undefined,
      maxTestFailures: overrides.maxTestFailures ? parseInt(overrides.maxTestFailures) : undefined,
      maxUniqueErrors: overrides.maxUniqueErrors ? parseInt(overrides.maxUniqueErrors) : undefined,
      systemPrompt: useCustomPrompt && systemPrompt ? systemPrompt : undefined,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      remediationFixAgents: useCustomFixAgents && remediationFixAgents.length > 0 ? remediationFixAgents : undefined,
      remediationReviewerKeys: useCustomReviewerKeys && remediationReviewerKeys.length > 0 ? remediationReviewerKeys : undefined,
      buildCommand: buildCommand || undefined,
      testCommand: testCommand || undefined,
      failSignals: useCustomFailSignals && failSignalsText.trim() ? failSignalsText.split("\n").filter((s) => s.trim()) : undefined,
      buildFixAgent: buildFixAgent || undefined,
      shellCommand: shellCommand || undefined,
      shellCaptureOutput: data.kind === "shell" ? shellCaptureOutput : undefined,
      llmInputTemplate: llmInputTemplate || undefined,
      agentConfig: agentConfig || undefined,
    });
  }, [nodeId, data, label, overrides, useCustomPrompt, systemPrompt, maxOutputTokens, useCustomFixAgents, remediationFixAgents, useCustomReviewerKeys, remediationReviewerKeys, buildCommand, testCommand, useCustomFailSignals, failSignalsText, buildFixAgent, shellCommand, shellCaptureOutput, llmInputTemplate, agentConfig, onUpdate]);

  const handleToggleCustomPrompt = useCallback((enabled: boolean) => {
    setUseCustomPrompt(enabled);
    if (!enabled) {
      setSystemPrompt("");
      setTimeout(save, 0);
    }
  }, [save]);

  const fields = KIND_FIELDS[data.kind] ?? [];
  const ioInfo = KIND_IO[data.kind];

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Kind</span>
        <select
          value={data.kind}
          onChange={(e) => {
            const newKind = e.target.value as ActionKind;
            onUpdate(nodeId, { ...data, kind: newKind, label: ACTION_KIND_LABELS[newKind] });
          }}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs h-7"
        >
          {ALL_ACTION_KINDS.map((k) => (
            <option key={k} value={k}>{ACTION_KIND_LABELS[k]}</option>
          ))}
        </select>
      </label>
      <div className="text-[10px] text-muted-foreground leading-relaxed">
        {KIND_DESCRIPTIONS[data.kind] ?? ""}
      </div>
      {/* Agent Config selector for agentic kinds */}
      {isAgentic ? (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Agent Config</span>
            <select
              value={agentConfig}
              onChange={(e) => { setAgentConfig(e.target.value); setTimeout(save, 0); }}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">Default ({KIND_AGENT_LABEL[data.kind] ?? "auto"})</option>
              {agentNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              Model/provider resolved via agent config. Leave blank for default.
            </p>
          </label>
        </div>
      ) : KIND_AGENT_LABEL[data.kind] ? (
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="text-muted-foreground">Agent:</span>
          <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{KIND_AGENT_LABEL[data.kind]}</code>
        </div>
      ) : null}

      {/* Build Command (for build-check kind) */}
      {data.kind === "build-check" && (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Build Command</span>
            <Input
              value={buildCommand}
              onChange={(e) => setBuildCommand(e.target.value)}
              onBlur={save}
              className="mt-0.5 h-6 text-xs font-mono"
              placeholder="bunx vite build --mode development"
            />
          </label>
        </div>
      )}

      {/* Test Command (for test-run kind) */}
      {data.kind === "test-run" && (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Test Command</span>
            <Input
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
              onBlur={save}
              className="mt-0.5 h-6 text-xs font-mono"
              placeholder="bunx vitest run"
            />
          </label>
        </div>
      )}

      {/* Build Fix Agent (for build-check and test-run kinds) */}
      {(data.kind === "build-check" || data.kind === "test-run") && (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Build Fix Agent</span>
            <select
              value={buildFixAgent}
              onChange={(e) => { setBuildFixAgent(e.target.value); setTimeout(save, 0); }}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">Auto-detect (default)</option>
              {agentNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              Agent that handles build/test fix attempts. Auto-detect routes based on error content.
            </p>
          </label>
        </div>
      )}

      {/* Shell Command (for shell kind) */}
      {data.kind === "shell" && (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Command <span className="text-destructive">*</span></span>
            <textarea
              value={shellCommand}
              onChange={(e) => setShellCommand(e.target.value)}
              onBlur={save}
              rows={3}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y"
              placeholder="echo 'hello world'"
            />
          </label>
          <label className="flex items-center gap-2 mt-1.5">
            <input
              type="checkbox"
              checked={shellCaptureOutput}
              onChange={(e) => { setShellCaptureOutput(e.target.checked); setTimeout(save, 0); }}
              className="rounded border-border h-3 w-3"
            />
            <span className="text-[10px] text-muted-foreground">Capture output as node result</span>
          </label>
        </div>
      )}

      {/* LLM Call Input Template (for llm-call kind) */}
      {data.kind === "llm-call" && (
        <div className="border-t border-border pt-2 mt-2">
          <label className="block">
            <span className="text-[10px] text-muted-foreground">Input Template <span className="text-destructive">*</span></span>
            <textarea
              value={llmInputTemplate}
              onChange={(e) => setLlmInputTemplate(e.target.value)}
              onBlur={save}
              rows={4}
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y"
              placeholder={"{{userMessage}}\n\nContext:\n{{output:architect}}"}
            />
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              Use {"{{userMessage}}"} for user request, {"{{output:nodeId}}"} for upstream outputs.
            </p>
          </label>
        </div>
      )}

      {/* LLM Configuration (for agentic kinds) */}
      {isAgentic && (
        <div className="border-t border-border pt-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">LLM Configuration</span>

          {/* System Prompt */}
          <div className="mt-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">System Prompt{data.kind === "llm-call" && <span className="text-destructive"> *</span>}</span>
                {useCustomPrompt && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-primary/20 text-primary">
                    custom
                  </span>
                )}
              </div>
              {useCustomPrompt && (
                <button
                  type="button"
                  onClick={() => handleToggleCustomPrompt(false)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Reset to default
                </button>
              )}
            </div>
            {useCustomPrompt ? (
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={save}
                rows={5}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y"
                placeholder="Enter custom system prompt..."
              />
            ) : (
              <div className="mt-1 space-y-1">
                <div
                  className="flex items-center justify-between text-[10px] text-muted-foreground italic cursor-pointer hover:text-foreground rounded border border-transparent hover:border-border px-1 py-0.5"
                  onClick={() => {
                    // Fetch default prompt, then copy into custom
                    api
                      .get<{ prompt: string }>(`/settings/actions/${data.kind}/defaultPrompt`)
                      .then((res) => {
                        setSystemPrompt(res.prompt);
                        setUseCustomPrompt(true);
                      })
                      .catch(() => setUseCustomPrompt(true));
                  }}
                >
                  <span>{KIND_DEFAULT_PROMPT_LABEL[data.kind] ?? "Using default prompt"}</span>
                  <span className="text-primary/60">Customize</span>
                </div>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    if (showDefaultPrompt) {
                      setShowDefaultPrompt(false);
                    } else {
                      api
                        .get<{ prompt: string }>(`/settings/actions/${data.kind}/defaultPrompt`)
                        .then((res) => {
                          setDefaultPromptText(res.prompt);
                          setShowDefaultPrompt(true);
                        })
                        .catch(() => setShowDefaultPrompt(false));
                    }
                  }}
                >
                  {showDefaultPrompt ? "Hide default" : "View default"}
                </button>
                {showDefaultPrompt && defaultPromptText && (
                  <textarea
                    readOnly
                    value={defaultPromptText}
                    rows={6}
                    className="w-full rounded-md border border-border bg-muted/50 px-2 py-1 text-[10px] font-mono resize-y text-muted-foreground"
                  />
                )}
              </div>
            )}
          </div>

          {/* Max Output Tokens */}
          <label className="block mt-2">
            <span className="text-[10px] text-muted-foreground">Max Output Tokens</span>
            <Input
              type="number"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              onBlur={save}
              className="mt-0.5 h-6 text-xs"
              placeholder={String(KIND_DEFAULT_MAX_TOKENS[data.kind] ?? 1024)}
              min={1}
            />
          </label>
        </div>
      )}

      {/* Remediation Configuration */}
      {isRemediation && (
        <div className="border-t border-border pt-2 mt-2 space-y-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Remediation Routing</span>

          {/* Fix Agents */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Fix Agents</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={useCustomFixAgents}
                  onChange={(e) => {
                    setUseCustomFixAgents(e.target.checked);
                    if (!e.target.checked) {
                      setRemediationFixAgents([]);
                      setTimeout(save, 0);
                    } else {
                      const defaults = ["frontend-dev", "backend-dev", "styling"];
                      setRemediationFixAgents(defaults);
                      setTimeout(save, 0);
                    }
                  }}
                  className="rounded border-border h-3 w-3"
                />
                <span className="text-[10px] text-muted-foreground">Override</span>
              </label>
            </div>
            {useCustomFixAgents ? (
              <div className="space-y-1">
                {agentNames.map((agent) => (
                  <label key={agent} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remediationFixAgents.includes(agent)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...remediationFixAgents, agent]
                          : remediationFixAgents.filter((a) => a !== agent);
                        setRemediationFixAgents(next);
                        setTimeout(save, 0);
                      }}
                      className="rounded border-border h-3 w-3"
                    />
                    <span className="text-[11px] font-mono text-foreground">{agent}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic">
                Auto-detect from review routing hints
              </div>
            )}
          </div>

          {/* Fail Signals */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Fail Signals</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={useCustomFailSignals}
                  onChange={(e) => {
                    setUseCustomFailSignals(e.target.checked);
                    if (!e.target.checked) {
                      setFailSignalsText("");
                      setTimeout(save, 0);
                    }
                  }}
                  className="rounded border-border h-3 w-3"
                />
                <span className="text-[10px] text-muted-foreground">Override</span>
              </label>
            </div>
            {useCustomFailSignals ? (
              <textarea
                value={failSignalsText}
                onChange={(e) => setFailSignalsText(e.target.value)}
                onBlur={save}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[10px] font-mono resize-y"
                placeholder={'One signal per line, e.g.:\n"status": "fail"\n[FAIL]\ncritical issue'}
              />
            ) : (
              <div className="text-[10px] text-muted-foreground italic">
                Using global fail signals (11 defaults)
              </div>
            )}
          </div>

          {/* Review Sources */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">Review Sources</span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={useCustomReviewerKeys}
                  onChange={(e) => {
                    setUseCustomReviewerKeys(e.target.checked);
                    if (!e.target.checked) {
                      setRemediationReviewerKeys([]);
                      setTimeout(save, 0);
                    } else {
                      const defaults = ["code-review", "qa", "security"];
                      setRemediationReviewerKeys(defaults);
                      setTimeout(save, 0);
                    }
                  }}
                  className="rounded border-border h-3 w-3"
                />
                <span className="text-[10px] text-muted-foreground">Override</span>
              </label>
            </div>
            {useCustomReviewerKeys ? (
              <div className="space-y-1">
                {agentNames.map((key) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={remediationReviewerKeys.includes(key)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...remediationReviewerKeys, key]
                          : remediationReviewerKeys.filter((k) => k !== key);
                        setRemediationReviewerKeys(next);
                        setTimeout(save, 0);
                      }}
                      className="rounded border-border h-3 w-3"
                    />
                    <span className="text-[11px] font-mono text-foreground">{key}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic">
                Default: code-review, qa, security
              </div>
            )}
          </div>
        </div>
      )}

      {ioInfo && (
        <>
          <div className="border-t border-border pt-2 mt-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Input</span>
            <div className="text-[10px] text-muted-foreground mt-1">{ioInfo.input}</div>
          </div>
          <div className="border-t border-border pt-2 mt-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</span>
            <div className="text-[10px] text-muted-foreground mt-1">
              Output key: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{ioInfo.outputKey}</code>
            </div>
          </div>
        </>
      )}
      {fields.length > 0 && (
        <div className="border-t border-border pt-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Overrides</span>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {fields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-[10px] text-muted-foreground">{field.label}</span>
                <Input
                  type="number"
                  value={overrides[field.key] ?? ""}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  onBlur={save}
                  className="mt-0.5 h-6 text-xs"
                  placeholder={field.placeholder}
                  min={1}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VersionInspector({ data, nodeId, onUpdate }: {
  data: VersionNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [label, setLabel] = useState(data.label);

  useEffect(() => {
    setLabel(data.label);
  }, [data]);

  const save = () => {
    onUpdate(nodeId, { ...data, label });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <div className="text-[10px] text-muted-foreground leading-relaxed">
        Creates a git version snapshot when reached during pipeline execution. The version will appear in the Previous Versions sidebar.
      </div>
      <div className="border-t border-border pt-2 mt-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Input</span>
        <div className="text-[10px] text-muted-foreground mt-1">Pass-through (no data consumed)</div>
      </div>
      <div className="border-t border-border pt-2 mt-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</span>
        <div className="text-[10px] text-muted-foreground mt-1">
          Output key: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{nodeId}</code>
        </div>
      </div>
    </div>
  );
}

