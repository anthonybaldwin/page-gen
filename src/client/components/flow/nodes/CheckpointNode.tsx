import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CirclePause } from "lucide-react";
import type { CheckpointNodeData } from "../../../../shared/flow-types.ts";

type CheckpointNodeProps = NodeProps & { data: CheckpointNodeData };

export const CheckpointNode = memo(function CheckpointNode({ data, selected }: CheckpointNodeProps) {
  return (
    <div className={`px-3 py-2 rounded-lg border border-blue-500/50 bg-blue-500/10 shadow-sm min-w-[140px] ${selected ? "ring-2 ring-blue-500" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <CirclePause className="h-4 w-4 text-blue-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.label || "Checkpoint"}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.skipInYolo ? "YOLO skip" : "Always pause"}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-2 !h-2" />
    </div>
  );
});
