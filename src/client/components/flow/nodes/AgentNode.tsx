import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";
import type { AgentNodeData } from "../../../../shared/flow-types.ts";

type AgentNodeProps = NodeProps & { data: AgentNodeData };

export const AgentNode = memo(function AgentNode({ data, selected }: AgentNodeProps) {
  return (
    <div className={`px-3 py-2 rounded-lg border bg-card text-card-foreground shadow-sm min-w-[160px] ${selected ? "ring-2 ring-primary" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-primary !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.agentName || "Agent"}</div>
          <div className="text-[10px] text-muted-foreground truncate">{data.inputTemplate ? "Has template" : "No template"}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary !w-2 !h-2" />
    </div>
  );
});
