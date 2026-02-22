import { Button } from "../ui/button.tsx";
import { Plus, Check, RotateCcw, AlertTriangle, Bot, GitBranch, CirclePause, Settings, CheckCircle2 } from "lucide-react";
import type { FlowNode, FlowNodeType, FlowNodeData } from "../../../shared/flow-types.ts";
import type { ValidationError } from "../../../shared/flow-validation.ts";
import { nanoid } from "nanoid";

interface FlowToolbarProps {
  onAddNode: (node: FlowNode) => void;
  onValidate: () => void;
  onSave: () => void;
  onResetDefaults: () => void;
  saving: boolean;
  errors: ValidationError[];
  dirty: boolean;
  validated?: boolean;
}

function makeNewNode(type: FlowNodeType): FlowNode {
  const id = `${type}-${nanoid(6)}`;
  let data: FlowNodeData;

  switch (type) {
    case "agent":
      data = { type: "agent", agentName: "", inputTemplate: "Original request: {{userMessage}}" };
      break;
    case "condition":
      data = { type: "condition", mode: "predefined", label: "Condition" };
      break;
    case "checkpoint":
      data = { type: "checkpoint", label: "Checkpoint", skipInYolo: true };
      break;
    case "post-action":
      data = { type: "post-action", actionType: "build-check", label: "Build Check" };
      break;
  }

  return {
    id,
    type,
    data,
    position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
  };
}

export function FlowToolbar({ onAddNode, onValidate, onSave, onResetDefaults, saving, errors, dirty, validated }: FlowToolbarProps) {
  const errorCount = errors.filter((e) => e.type === "error").length;
  const warningCount = errors.filter((e) => e.type === "warning").length;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 border-r border-border pr-2 mr-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Add</span>
        <Button variant="outline" size="sm" onClick={() => onAddNode(makeNewNode("agent"))} className="h-7 text-xs gap-1">
          <Bot className="h-3 w-3" /> Agent
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAddNode(makeNewNode("condition"))} className="h-7 text-xs gap-1">
          <GitBranch className="h-3 w-3" /> Condition
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAddNode(makeNewNode("checkpoint"))} className="h-7 text-xs gap-1">
          <CirclePause className="h-3 w-3" /> Checkpoint
        </Button>
        <Button variant="outline" size="sm" onClick={() => onAddNode(makeNewNode("post-action"))} className="h-7 text-xs gap-1">
          <Settings className="h-3 w-3" /> Post-Action
        </Button>
      </div>

      <Button variant="outline" size="sm" onClick={onValidate} className="h-7 text-xs gap-1">
        <Check className="h-3 w-3" /> Validate
      </Button>

      {validated && errors.length === 0 && (
        <span className="flex items-center gap-0.5 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Valid
        </span>
      )}

      {(errorCount > 0 || warningCount > 0) && (
        <div className="flex items-center gap-1 text-xs">
          {errorCount > 0 && (
            <span className="flex items-center gap-0.5 text-destructive">
              <AlertTriangle className="h-3 w-3" /> {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-0.5 text-amber-500">
              <AlertTriangle className="h-3 w-3" /> {warningCount} warning{warningCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onResetDefaults} className="h-7 text-xs gap-1">
          <RotateCcw className="h-3 w-3" /> Reset Defaults
        </Button>
        {dirty && (
          <Button size="sm" onClick={onSave} disabled={saving || errorCount > 0} className="h-7 text-xs">
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}
