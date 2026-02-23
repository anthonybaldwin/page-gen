import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Settings } from "lucide-react";
import type { ConfigNodeData } from "../../../../shared/flow-types.ts";

type ConfigNodeProps = NodeProps & { data: ConfigNodeData };

export const ConfigNode = memo(function ConfigNode({ data, selected }: ConfigNodeProps) {
  const hasPrompt = !!data.baseSystemPrompt?.trim();
  const preview = hasPrompt
    ? data.baseSystemPrompt!.slice(0, 60) + (data.baseSystemPrompt!.length > 60 ? "..." : "")
    : "No base prompt";

  return (
    <div className={`px-3 py-2 rounded-lg border-2 border-indigo-400 bg-card text-card-foreground shadow-sm min-w-[160px] ${selected ? "ring-2 ring-indigo-500" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-indigo-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Settings className="h-4 w-4 text-indigo-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-medium truncate">{data.label || "Pipeline Config"}</div>
          <div className="text-[10px] text-muted-foreground truncate">{preview}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-indigo-500 !w-2 !h-2" />
    </div>
  );
});
