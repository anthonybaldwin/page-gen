import { useState, useEffect, useCallback } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import { api } from "../../lib/api.ts";
import type { FlowNode, FlowNodeData, AgentNodeData, ConditionNodeData, CheckpointNodeData, ActionNodeData } from "../../../shared/flow-types.ts";
import { PREDEFINED_CONDITIONS } from "../../../shared/flow-types.ts";
import type { PipelineConfig } from "../settings/PipelineSettings.tsx";

interface FlowNodeInspectorProps {
  node: FlowNode | null;
  agentNames: string[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
  pipelineDefaults?: PipelineConfig | null;
}

export function FlowNodeInspector({ node, agentNames, onUpdate, onDelete, pipelineDefaults }: FlowNodeInspectorProps) {
  if (!node) return null;

  return (
    <div className="space-y-3 p-3 border-l border-border min-w-[240px]">
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
        <AgentInspector data={node.data} nodeId={node.id} agentNames={agentNames} onUpdate={onUpdate} pipelineDefaults={pipelineDefaults} />
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

function AgentInspector({ data, nodeId, agentNames, onUpdate, pipelineDefaults }: {
  data: AgentNodeData;
  nodeId: string;
  agentNames: string[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  pipelineDefaults?: PipelineConfig | null;
}) {
  const [agentName, setAgentName] = useState(data.agentName);
  const [inputTemplate, setInputTemplate] = useState(data.inputTemplate);
  const [maxOutputTokens, setMaxOutputTokens] = useState(data.maxOutputTokens?.toString() ?? "");
  const [maxToolSteps, setMaxToolSteps] = useState(data.maxToolSteps?.toString() ?? "");
  const [agentDefaultPrompt, setAgentDefaultPrompt] = useState<string | null>(null);

  useEffect(() => {
    setAgentName(data.agentName);
    setInputTemplate(data.inputTemplate);
    setMaxOutputTokens(data.maxOutputTokens?.toString() ?? "");
    setMaxToolSteps(data.maxToolSteps?.toString() ?? "");
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

  const save = useCallback(() => {
    onUpdate(nodeId, {
      ...data,
      agentName,
      inputTemplate,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
    });
  }, [nodeId, data, agentName, inputTemplate, maxOutputTokens, maxToolSteps, onUpdate]);

  const handleAgentChange = useCallback((newAgentName: string) => {
    setAgentName(newAgentName);
    if (!newAgentName) return;

    // Auto-populate prompt from agent's default when current prompt is empty or generic
    api
      .get<{ defaultPrompt: string; isCustom: boolean }>(`/settings/agents/${newAgentName}/defaultPrompt`)
      .then((res) => {
        setAgentDefaultPrompt(res.defaultPrompt);
        const currentIsGenericOrEmpty =
          !inputTemplate || inputTemplate === GENERIC_PROMPT || inputTemplate === "{{userMessage}}";
        if (currentIsGenericOrEmpty) {
          setInputTemplate(res.defaultPrompt);
          // Save immediately with new values
          onUpdate(nodeId, {
            ...data,
            agentName: newAgentName,
            inputTemplate: res.defaultPrompt,
            maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
            maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
          });
        } else {
          onUpdate(nodeId, {
            ...data,
            agentName: newAgentName,
            inputTemplate,
            maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
            maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
          });
        }
      })
      .catch(() => {
        setAgentDefaultPrompt(null);
        onUpdate(nodeId, {
          ...data,
          agentName: newAgentName,
          inputTemplate,
          maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
          maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
        });
      });
  }, [inputTemplate, maxOutputTokens, maxToolSteps, nodeId, data, onUpdate]);

  const handleResetToDefault = useCallback(() => {
    if (agentDefaultPrompt) {
      setInputTemplate(agentDefaultPrompt);
      onUpdate(nodeId, {
        ...data,
        agentName,
        inputTemplate: agentDefaultPrompt,
        maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
        maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
      });
    }
  }, [agentDefaultPrompt, agentName, maxOutputTokens, maxToolSteps, nodeId, data, onUpdate]);

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
      </label>
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

  useEffect(() => {
    setLabel(data.label);
    setSkipInYolo(data.skipInYolo);
  }, [data]);

  const save = () => {
    onUpdate(nodeId, { ...data, label, skipInYolo });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
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
    </div>
  );
}

const KIND_DESCRIPTIONS: Record<string, string> = {
  "build-check": "Runs a build check at this point in the pipeline. If errors are found, a dev agent attempts to fix them.",
  "test-run": "Runs the project's test suite. If tests fail, a dev agent attempts to fix them.",
  "remediation": "Iteratively fixes issues found by review agents. Re-runs reviews until clean or max cycles reached.",
};

function ActionInspector({ data, nodeId, onUpdate }: {
  data: ActionNodeData;
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
        {KIND_DESCRIPTIONS[data.kind] ?? ""}
      </div>
    </div>
  );
}

