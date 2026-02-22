import { memo, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { Wrench, RefreshCw } from "lucide-react";

interface GhostNodeData {
  variant: "build-check" | "remediation";
  label: string;
}

type GhostNodeProps = NodeProps & { data: GhostNodeData };

const TOOLTIPS: Record<string, string> = {
  "build-check": "Build checks run automatically after each agent that writes files",
  "remediation": "Remediation runs automatically after review agents to fix issues",
};

export const GhostNode = memo(function GhostNode({ data }: GhostNodeProps) {
  const [hovered, setHovered] = useState(false);
  const Icon = data.variant === "remediation" ? RefreshCw : Wrench;

  return (
    <div
      className="relative flex items-center justify-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Diamond shape */}
      <div className="w-[30px] h-[30px] rotate-45 rounded-[4px] border border-dashed border-muted-foreground/40 bg-muted/50 flex items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60 -rotate-45" />
      </div>

      {/* Label below */}
      <div className="absolute top-[36px] whitespace-nowrap text-[9px] text-muted-foreground/60 font-medium select-none">
        {data.label}
      </div>

      {/* Tooltip on hover */}
      {hovered && (
        <div className="absolute bottom-[40px] left-1/2 -translate-x-1/2 z-50 px-2 py-1 rounded bg-popover border border-border shadow-md text-[10px] text-popover-foreground whitespace-nowrap">
          {TOOLTIPS[data.variant] ?? data.label}
        </div>
      )}
    </div>
  );
});
