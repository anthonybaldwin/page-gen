import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import type { ConditionNodeData } from "../../../../shared/flow-types.ts";

type ConditionNodeProps = NodeProps & { data: ConditionNodeData };

export const ConditionNode = memo(function ConditionNode({ data, selected }: ConditionNodeProps) {
  return (
    <div className={`relative px-3 py-2 rounded-lg border border-amber-500/50 bg-amber-500/10 shadow-sm min-w-[140px] ${selected ? "ring-2 ring-amber-500" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-amber-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.label || "Condition"}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.mode === "predefined" ? data.predefined ?? "—" : "expression"}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="true" className="!bg-green-500 !w-2 !h-2" style={{ top: "30%" }} />
      <span className="absolute text-[9px] font-medium text-green-600 dark:text-green-400" style={{ right: -24, top: "20%", transform: "translateY(-50%)" }}>yes</span>
      <Handle type="source" position={Position.Right} id="false" className="!bg-red-500 !w-2 !h-2" style={{ top: "70%" }} />
      <span className="absolute text-[9px] font-medium text-red-600 dark:text-red-400" style={{ right: -18, top: "70%", transform: "translateY(-50%)" }}>no</span>
    </div>
  );
});
