import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bookmark } from "lucide-react";
import type { VersionNodeData } from "../../../../shared/flow-types.ts";

type VersionNodeProps = NodeProps & { data: VersionNodeData };

export const VersionNode = memo(function VersionNode({ data, selected }: VersionNodeProps) {
  return (
    <div className={`px-3 py-2 rounded-lg border border-teal-500/50 bg-teal-500/10 shadow-sm min-w-[140px] ${selected ? "ring-2 ring-teal-500" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-teal-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Bookmark className="h-4 w-4 text-teal-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.label || "Version"}</div>
          <div className="text-[10px] text-muted-foreground truncate">Auto-save</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-teal-500 !w-2 !h-2" />
    </div>
  );
});
