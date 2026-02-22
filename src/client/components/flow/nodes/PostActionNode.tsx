import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Settings } from "lucide-react";
import type { PostActionNodeData } from "../../../../shared/flow-types.ts";

const ACTION_LABELS: Record<string, string> = {
  "build-check": "Build Check",
  "test-run": "Test Run",
  "build-fix-loop": "Build Fix Loop",
  "remediation-loop": "Remediation Loop",
};

type PostActionNodeProps = NodeProps & { data: PostActionNodeData };

export const PostActionNode = memo(function PostActionNode({ data, selected }: PostActionNodeProps) {
  return (
    <div className={`px-3 py-2 rounded-lg border border-purple-500/50 bg-purple-500/10 shadow-sm min-w-[140px] ${selected ? "ring-2 ring-purple-500" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-purple-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-purple-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.label || ACTION_LABELS[data.actionType] || "Post Action"}</div>
          <div className="text-[10px] text-muted-foreground truncate">{data.actionType}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-purple-500 !w-2 !h-2" />
    </div>
  );
});
