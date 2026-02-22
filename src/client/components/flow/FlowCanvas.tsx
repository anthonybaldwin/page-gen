import { useCallback, useEffect, useMemo } from "react";
import { useThemeStore } from "../../stores/themeStore.ts";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode } from "./nodes/AgentNode.tsx";
import { ConditionNode } from "./nodes/ConditionNode.tsx";
import { CheckpointNode } from "./nodes/CheckpointNode.tsx";
import { ActionNode } from "./nodes/ActionNode.tsx";
import type { FlowTemplate, FlowNode, FlowEdge } from "../../../shared/flow-types.ts";

const nodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  checkpoint: CheckpointNode,
  action: ActionNode,
};

/** Convert our FlowNode[] to React Flow Node[] */
function toRFNodes(flowNodes: FlowNode[]): Node[] {
  return flowNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data as unknown as Record<string, unknown>,
  }));
}

/** Convert our FlowEdge[] to React Flow Edge[] */
function toRFEdges(flowEdges: FlowEdge[]): Edge[] {
  return flowEdges.map((e) => {
    // Condition branch edges have labels shown on the node handles — skip edge labels
    const isConditionBranch = e.sourceHandle === "true" || e.sourceHandle === "false";
    // Color condition branches: green for true, red for false
    const branchColor = e.sourceHandle === "true"
      ? "#22c55e"
      : e.sourceHandle === "false"
        ? "#ef4444"
        : undefined;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      type: "default",
      label: isConditionBranch ? undefined : e.label,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
      labelStyle: { fontSize: 10, fill: "hsl(var(--foreground))" },
      animated: true,
      style: { strokeWidth: 1.5, ...(branchColor ? { stroke: branchColor } : {}) },
    };
  });
}

/** Convert React Flow Node[] back to our FlowNode[] */
function fromRFNodes(rfNodes: Node[]): FlowNode[] {
  return rfNodes.map((n) => ({
    id: n.id,
    type: n.type as FlowNode["type"],
    data: n.data as unknown as FlowNode["data"],
    position: n.position,
  }));
}

/** Convert React Flow Edge[] back to our FlowEdge[] */
function fromRFEdges(rfEdges: Edge[]): FlowEdge[] {
  return rfEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    label: typeof e.label === "string" ? e.label : undefined,
  }));
}

interface FlowCanvasProps {
  template: FlowTemplate;
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onNodeSelect: (nodeId: string | null) => void;
}

export function FlowCanvas({ template, onChange, onNodeSelect }: FlowCanvasProps) {
  const isDark = useThemeStore((s) => s.resolvedTheme) === "dark";
  const initialNodes = useMemo(() => toRFNodes(template.nodes), [template.id]);
  const initialEdges = useMemo(() => toRFEdges(template.edges), [template.id]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync external node changes (additions from toolbar, deletions from inspector/reset)
  const templateNodeIds = template.nodes.map(n => n.id).join(",");
  useEffect(() => {
    setNodes(current => {
      const templateIds = new Set(template.nodes.map(n => n.id));
      const currentIds = new Set(current.map(n => n.id));
      // Remove nodes no longer in template
      let updated = current.filter(n => templateIds.has(n.id));
      // Add nodes new to template
      const added = template.nodes.filter(n => !currentIds.has(n.id));
      if (added.length > 0) updated = [...updated, ...toRFNodes(added)];
      if (updated.length === current.length && added.length === 0) return current;
      return updated;
    });
  }, [templateNodeIds, setNodes]);

  // Sync external edge changes
  const templateEdgeIds = template.edges.map(e => e.id).join(",");
  useEffect(() => {
    setEdges(current => {
      const templateIds = new Set(template.edges.map(e => e.id));
      const currentIds = new Set(current.map(e => e.id));
      let updated = current.filter(e => templateIds.has(e.id));
      const added = template.edges.filter(e => !currentIds.has(e.id));
      if (added.length > 0) updated = [...updated, ...toRFEdges(added)];
      if (updated.length === current.length && added.length === 0) return current;
      return updated;
    });
  }, [templateEdgeIds, setEdges]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const newEdges = addEdge(
          {
            ...connection,
            animated: true,
            style: { strokeWidth: 1.5 },
          },
          eds,
        );
        // Notify parent of change
        setTimeout(() => onChange(fromRFNodes(nodes), fromRFEdges(newEdges)), 0);
        return newEdges;
      });
    },
    [nodes, onChange, setEdges],
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Defer notifying parent so state is updated
      setTimeout(() => {
        setNodes((current) => {
          onChange(fromRFNodes(current), fromRFEdges(edges));
          return current;
        });
      }, 0);
    },
    [onNodesChange, edges, onChange, setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      setTimeout(() => {
        setEdges((current) => {
          onChange(fromRFNodes(nodes), fromRFEdges(current));
          return current;
        });
      }, 0);
    },
    [onEdgesChange, nodes, onChange, setEdges],
  );

  /** Apply highlight: bolden matched edges, fade the rest */
  const highlightEdges = useCallback(
    (match: (e: Edge) => boolean) => {
      setEdges(current =>
        current.map(e => {
          const hit = match(e);
          return {
            ...e,
            zIndex: hit ? 1000 : 0,
            style: {
              ...e.style,
              strokeWidth: hit ? 2.5 : 1,
              opacity: hit ? 1 : 0.4,
            },
          };
        }),
      );
    },
    [setEdges],
  );

  /** Restore original branch colors (green for true, red for false) */
  const resetEdgeStyles = useCallback(() => {
    setEdges(current =>
      current.map(e => {
        const branchColor = e.sourceHandle === "true"
          ? "#22c55e"
          : e.sourceHandle === "false"
            ? "#ef4444"
            : undefined;
        return {
          ...e,
          zIndex: 0,
          style: { ...e.style, strokeWidth: 1.5, opacity: 1, stroke: branchColor ?? undefined },
        };
      }),
    );
  }, [setEdges]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (selectedNodes.length === 1 && selectedNodes[0]) {
        const nodeId = selectedNodes[0].id;
        onNodeSelect(nodeId);
        highlightEdges(e => e.source === nodeId || e.target === nodeId);
      } else {
        onNodeSelect(null);
        resetEdgeStyles();
      }
    },
    [onNodeSelect, highlightEdges, resetEdgeStyles],
  );

  /** Hover/click an edge → highlight all sibling edges (same source + sourceHandle) */
  const handleEdgeMouseEnter = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      highlightEdges(e =>
        e.id === edge.id ||
        (e.source === edge.source && e.sourceHandle === edge.sourceHandle),
      );
    },
    [highlightEdges],
  );

  const handleEdgeMouseLeave = useCallback(() => {
    resetEdgeStyles();
  }, [resetEdgeStyles]);

  return (
    <div className="h-full w-full min-h-[300px] rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        elevateEdgesOnSelect
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
        defaultEdgeOptions={{
          type: "default",
          animated: true,
          selectable: true,
          style: { strokeWidth: 1.5 },
        }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} className="!bg-card !border-border !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
        <MiniMap
          className="!bg-card !border-border !shadow-sm"
          maskColor={isDark ? "rgba(0, 0, 0, 0.7)" : "rgba(0, 0, 0, 0.15)"}
          maskStrokeColor={isDark ? "rgba(140, 160, 255, 0.5)" : "rgba(80, 80, 180, 0.4)"}
          maskStrokeWidth={2}
          pannable
          zoomable
          nodeBorderRadius={2}
          nodeColor={(node) => {
            switch (node.type) {
              case "agent": return isDark ? "#60a5fa" : "#3b82f6";
              case "condition": return "#f59e0b";
              case "checkpoint": return "#3b82f6";
              case "action": {
                const kind = (node.data as Record<string, unknown>)?.kind;
                switch (kind) {
                  case "build-check": return "#f97316";
                  case "test-run": return "#10b981";
                  case "remediation": return "#8b5cf6";
                  case "summary": return "#f59e0b";
                  case "vibe-intake": return "#ec4899";
                  case "mood-analysis": return "#0ea5e9";
                  default: return "#f97316";
                }
              }
              default: return isDark ? "#aaa" : "#888";
            }
          }}
        />
      </ReactFlow>
    </div>
  );
}
