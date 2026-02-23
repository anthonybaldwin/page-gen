import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Hammer, FlaskConical, RefreshCw, Sparkles, Image, FileText, Terminal, MessageSquare, MessageCircleReply } from "lucide-react";
import type { ActionNodeData } from "../../../../shared/flow-types.ts";

type ActionNodeProps = NodeProps & { data: ActionNodeData };

const KIND_CONFIG: Record<string, { icon: typeof Hammer; color: string; ringColor: string }> = {
  "build-check": { icon: Hammer, color: "text-orange-500", ringColor: "ring-orange-500" },
  "test-run": { icon: FlaskConical, color: "text-emerald-500", ringColor: "ring-emerald-500" },
  "remediation": { icon: RefreshCw, color: "text-violet-500", ringColor: "ring-violet-500" },
  "summary": { icon: FileText, color: "text-amber-500", ringColor: "ring-amber-500" },
  "vibe-intake": { icon: Sparkles, color: "text-pink-500", ringColor: "ring-pink-500" },
  "mood-analysis": { icon: Image, color: "text-sky-500", ringColor: "ring-sky-500" },
  "answer": { icon: MessageCircleReply, color: "text-indigo-500", ringColor: "ring-indigo-500" },
  "shell": { icon: Terminal, color: "text-slate-500", ringColor: "ring-slate-500" },
  "llm-call": { icon: MessageSquare, color: "text-cyan-500", ringColor: "ring-cyan-500" },
};

export const ActionNode = memo(function ActionNode({ data, selected }: ActionNodeProps) {
  const config = KIND_CONFIG[data.kind] ?? KIND_CONFIG["build-check"]!;
  const Icon = config.icon;

  return (
    <div className={`px-3 py-2 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 shadow-sm min-w-[120px] ${selected ? `ring-2 ${config.ringColor}` : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${config.color} shrink-0`} />
        <div className="text-xs font-medium truncate">{data.label}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground !w-2 !h-2" />
    </div>
  );
});
