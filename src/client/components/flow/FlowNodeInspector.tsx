import { useState, useEffect } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import type { FlowNode, FlowNodeData, AgentNodeData, ConditionNodeData, CheckpointNodeData, PostActionNodeData, PostActionType } from "../../../shared/flow-types.ts";
import { PREDEFINED_CONDITIONS } from "../../../shared/flow-types.ts";

interface FlowNodeInspectorProps {
  node: FlowNode | null;
  agentNames: string[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
}

export function FlowNodeInspector({ node, agentNames, onUpdate, onDelete }: FlowNodeInspectorProps) {
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
        <AgentInspector data={node.data} nodeId={node.id} agentNames={agentNames} onUpdate={onUpdate} />
      )}
      {node.data.type === "condition" && (
        <ConditionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
      {node.data.type === "checkpoint" && (
        <CheckpointInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
      {node.data.type === "post-action" && (
        <PostActionInspector data={node.data} nodeId={node.id} onUpdate={onUpdate} />
      )}
    </div>
  );
}

function AgentInspector({ data, nodeId, agentNames, onUpdate }: {
  data: AgentNodeData;
  nodeId: string;
  agentNames: string[];
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [agentName, setAgentName] = useState(data.agentName);
  const [inputTemplate, setInputTemplate] = useState(data.inputTemplate);

  useEffect(() => {
    setAgentName(data.agentName);
    setInputTemplate(data.inputTemplate);
  }, [data]);

  const save = () => {
    onUpdate(nodeId, { ...data, agentName, inputTemplate });
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

function PostActionInspector({ data, nodeId, onUpdate }: {
  data: PostActionNodeData;
  nodeId: string;
  onUpdate: (nodeId: string, data: FlowNodeData) => void;
}) {
  const [actionType, setActionType] = useState<PostActionType>(data.actionType);
  const [label, setLabel] = useState(data.label);

  useEffect(() => {
    setActionType(data.actionType);
    setLabel(data.label);
  }, [data]);

  const save = () => {
    onUpdate(nodeId, { ...data, actionType, label });
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
    </div>
  );
}
