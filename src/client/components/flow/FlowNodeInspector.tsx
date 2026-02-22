import { useState, useEffect } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import type { FlowNode, FlowNodeData, AgentNodeData, ConditionNodeData, CheckpointNodeData, PostActionNodeData, PostActionType } from "../../../shared/flow-types.ts";
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
  if (!node) {
    return (
      <div className="text-xs text-muted-foreground p-3 text-center">
        Select a node to edit its properties
      </div>
    );
  }

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
      {node.data.type === "post-action" && (
        <PostActionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} pipelineDefaults={pipelineDefaults} />
      )}
    </div>
  );
}

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

  useEffect(() => {
    setAgentName(data.agentName);
    setInputTemplate(data.inputTemplate);
    setMaxOutputTokens(data.maxOutputTokens?.toString() ?? "");
    setMaxToolSteps(data.maxToolSteps?.toString() ?? "");
  }, [data]);

  const save = () => {
    onUpdate(nodeId, {
      ...data,
      agentName,
      inputTemplate,
      maxOutputTokens: maxOutputTokens ? parseInt(maxOutputTokens) : undefined,
      maxToolSteps: maxToolSteps ? parseInt(maxToolSteps) : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Agent</span>
        <select
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          onBlur={save}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="">Select agent...</option>
          {agentNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Input Template</span>
        <textarea
          value={inputTemplate}
          onChange={(e) => setInputTemplate(e.target.value)}
          onBlur={save}
          rows={4}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs font-mono resize-y"
          placeholder="Use {{userMessage}} for interpolation"
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

/** Which override fields are relevant per action type */
const POST_ACTION_FIELDS: Record<PostActionType, Array<"timeoutMs" | "maxAttempts" | "maxTestFailures" | "maxUniqueErrors">> = {
  "build-check": ["timeoutMs"],
  "test-run": ["timeoutMs", "maxTestFailures", "maxUniqueErrors"],
  "build-fix-loop": ["timeoutMs", "maxAttempts", "maxUniqueErrors"],
  "remediation-loop": ["maxAttempts"],
};

const FIELD_LABELS: Record<string, string> = {
  timeoutMs: "Timeout (ms)",
  maxAttempts: "Max Attempts",
  maxTestFailures: "Max Test Failures",
  maxUniqueErrors: "Max Unique Errors",
};

/** Resolve the placeholder default for a post-action field based on action type */
function getPostActionDefault(
  field: string,
  actionType: PostActionType,
  defaults?: PipelineConfig | null,
): string {
  if (!defaults) return "";
  switch (field) {
    case "timeoutMs":
      return actionType === "test-run"
        ? String(defaults.testTimeoutMs)
        : String(defaults.buildTimeoutMs);
    case "maxAttempts":
      return actionType === "remediation-loop"
        ? String(defaults.maxRemediationCycles)
        : String(defaults.maxBuildFixAttempts);
    case "maxTestFailures":
      return String(defaults.maxTestFailures);
    case "maxUniqueErrors":
      return String(defaults.maxUniqueErrors);
    default:
      return "";
  }
}

function PostActionInspector({ data, nodeId, onUpdate, pipelineDefaults }: {
  data: PostActionNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  pipelineDefaults?: PipelineConfig | null;
}) {
  const [actionType, setActionType] = useState<PostActionType>(data.actionType);
  const [label, setLabel] = useState(data.label);
  const [timeoutMs, setTimeoutMs] = useState(data.timeoutMs?.toString() ?? "");
  const [maxAttempts, setMaxAttempts] = useState(data.maxAttempts?.toString() ?? "");
  const [maxTestFailures, setMaxTestFailures] = useState(data.maxTestFailures?.toString() ?? "");
  const [maxUniqueErrors, setMaxUniqueErrors] = useState(data.maxUniqueErrors?.toString() ?? "");

  useEffect(() => {
    setActionType(data.actionType);
    setLabel(data.label);
    setTimeoutMs(data.timeoutMs?.toString() ?? "");
    setMaxAttempts(data.maxAttempts?.toString() ?? "");
    setMaxTestFailures(data.maxTestFailures?.toString() ?? "");
    setMaxUniqueErrors(data.maxUniqueErrors?.toString() ?? "");
  }, [data]);

  const save = () => {
    onUpdate(nodeId, {
      ...data,
      actionType,
      label,
      timeoutMs: timeoutMs ? parseInt(timeoutMs) : undefined,
      maxAttempts: maxAttempts ? parseInt(maxAttempts) : undefined,
      maxTestFailures: maxTestFailures ? parseInt(maxTestFailures) : undefined,
      maxUniqueErrors: maxUniqueErrors ? parseInt(maxUniqueErrors) : undefined,
    });
  };

  const fields = POST_ACTION_FIELDS[actionType] ?? [];
  const fieldState: Record<string, { value: string; set: (v: string) => void }> = {
    timeoutMs: { value: timeoutMs, set: setTimeoutMs },
    maxAttempts: { value: maxAttempts, set: setMaxAttempts },
    maxTestFailures: { value: maxTestFailures, set: setMaxTestFailures },
    maxUniqueErrors: { value: maxUniqueErrors, set: setMaxUniqueErrors },
  };

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-muted-foreground">Label</span>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={save} className="mt-1 h-7 text-xs" />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Action Type</span>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value as PostActionType)}
          onBlur={save}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value="build-check">Build Check</option>
          <option value="test-run">Test Run</option>
          <option value="build-fix-loop">Build Fix Loop</option>
          <option value="remediation-loop">Remediation Loop</option>
        </select>
      </label>
      {fields.length > 0 && (
        <div className="border-t border-border pt-2 mt-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Overrides</span>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {fields.map((field) => {
              const fs = fieldState[field];
              if (!fs) return null;
              const placeholder = getPostActionDefault(field, actionType, pipelineDefaults);
              return (
                <label key={field} className="block">
                  <span className="text-[10px] text-muted-foreground">{FIELD_LABELS[field]}</span>
                  <Input
                    type="number"
                    value={fs.value}
                    onChange={(e) => fs.set(e.target.value)}
                    onBlur={save}
                    className="mt-0.5 h-6 text-xs"
                    placeholder={placeholder}
                    min={1}
                  />
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
