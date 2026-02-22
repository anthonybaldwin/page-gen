import { useState, useEffect, useCallback, useMemo } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import { api } from "../../lib/api.ts";
import type { FlowNode, FlowEdge, FlowNodeData, AgentNodeData, ConditionNodeData, CheckpointNodeData, ActionNodeData, UpstreamSource, UpstreamTransform } from "../../../shared/flow-types.ts";
import { PREDEFINED_CONDITIONS, UPSTREAM_TRANSFORMS, WELL_KNOWN_SOURCES } from "../../../shared/flow-types.ts";
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
        <ActionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
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

  useEffect(() => {
    setAgentName(data.agentName);
    setInputTemplate(data.inputTemplate);
    setMaxOutputTokens(data.maxOutputTokens?.toString() ?? "");
    setMaxToolSteps(data.maxToolSteps?.toString() ?? "");
    setUpstreamSources(data.upstreamSources ?? []);
    setShowSources(!!data.upstreamSources);
  }, [data]);

  // Fetch default prompt when agent name is set
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

  const buildData = useCallback(
    (overrides?: Partial<AgentNodeData>): AgentNodeData => ({
      ...data,
      agentName,
      inputTemplate,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
      upstreamSources: showSources ? upstreamSources : undefined,
      ...overrides,
    }),
    [data, agentName, inputTemplate, maxOutputTokens, maxToolSteps, upstreamSources, showSources],
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

      {/* Data Flow summary */}
      <div className="border-t border-border pt-2 mt-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Data Flow</span>
        <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
          {checkpointType === "design_direction"
            ? "Receives architect output \u2192 Extracts design directions \u2192 User selects one \u2192 Passes selected design_system to downstream nodes"
            : "Pauses the pipeline and waits for user approval before continuing."}
        </div>
      </div>
    </div>
  );
}

const KIND_DESCRIPTIONS: Record<string, string> = {
  "build-check": "Runs a build check at this point in the pipeline. If errors are found, a dev agent attempts to fix them.",
  "test-run": "Runs the project's test suite. If tests fail, a dev agent attempts to fix them.",
  "remediation": "Iteratively fixes issues found by review agents. Re-runs reviews until clean or max cycles reached.",
  "vibe-intake": "Loads the project's vibe brief (adjectives, metaphor, target user) and injects it into the pipeline context.",
  "mood-analysis": "Analyzes uploaded mood board images using a vision model and extracts color palette, style descriptors, and mood keywords.",
};

const KIND_OUTPUTS: Record<string, string> = {
  "vibe-intake": "Produces: vibe-brief (JSON: adjectives, metaphor, target user)",
  "mood-analysis": "Produces: mood-analysis (JSON: palette, style descriptors, mood keywords)",
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
    { key: "maxTestFailures", label: "Max Test Failures", placeholder: "5" },
    { key: "maxUniqueErrors", label: "Max Unique Errors", placeholder: "10" },
  ],
  "remediation": [
    { key: "maxAttempts", label: "Max Cycles", placeholder: "2" },
  ],
};

function ActionInspector({ data, nodeId, onUpdate }: {
  data: ActionNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [label, setLabel] = useState(data.label);
  const [overrides, setOverrides] = useState<Record<string, string>>({
    timeoutMs: data.timeoutMs?.toString() ?? "",
    maxAttempts: data.maxAttempts?.toString() ?? "",
    maxTestFailures: data.maxTestFailures?.toString() ?? "",
    maxUniqueErrors: data.maxUniqueErrors?.toString() ?? "",
  });

  useEffect(() => {
    setLabel(data.label);
    setOverrides({
      timeoutMs: data.timeoutMs?.toString() ?? "",
      maxAttempts: data.maxAttempts?.toString() ?? "",
      maxTestFailures: data.maxTestFailures?.toString() ?? "",
      maxUniqueErrors: data.maxUniqueErrors?.toString() ?? "",
    });
  }, [data]);

  const save = () => {
    onUpdate(nodeId, {
      ...data,
      label,
      timeoutMs: overrides.timeoutMs ? parseInt(overrides.timeoutMs) : undefined,
      maxAttempts: overrides.maxAttempts ? parseInt(overrides.maxAttempts) : undefined,
      maxTestFailures: overrides.maxTestFailures ? parseInt(overrides.maxTestFailures) : undefined,
      maxUniqueErrors: overrides.maxUniqueErrors ? parseInt(overrides.maxUniqueErrors) : undefined,
    });
  };

  const fields = KIND_FIELDS[data.kind] ?? [];
  const outputInfo = KIND_OUTPUTS[data.kind];

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <div className="text-[10px] text-muted-foreground leading-relaxed">
        {KIND_DESCRIPTIONS[data.kind] ?? ""}
      </div>
      {outputInfo && (
        <div className="border-t border-border pt-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Output</span>
          <div className="text-[10px] text-muted-foreground mt-1">{outputInfo}</div>
        </div>
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
