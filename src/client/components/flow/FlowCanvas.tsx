import { useCallback, useEffect, useMemo } from "react";
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
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AgentNode } from "./nodes/AgentNode.tsx";
import { ConditionNode } from "./nodes/ConditionNode.tsx";
import { CheckpointNode } from "./nodes/CheckpointNode.tsx";
import { PostActionNode } from "./nodes/PostActionNode.tsx";
import type { FlowTemplate, FlowNode, FlowEdge } from "../../../shared/flow-types.ts";

const nodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  checkpoint: CheckpointNode,
  "post-action": PostActionNode,
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
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      type: "smoothstep",
      label: isConditionBranch ? undefined : e.label,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: "hsl(var(--card))", fillOpacity: 0.95 },
      labelStyle: { fontSize: 10, fill: "hsl(var(--foreground))" },
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.5 },
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
  const initialNodes = useMemo(() => toRFNodes(template.nodes), [template.id]);
  const initialEdges = useMemo(() => toRFEdges(template.edges), [template.id]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync externally-added nodes (e.g. from toolbar)
  useEffect(() => {
    setNodes(current => {
      const currentIds = new Set(current.map(n => n.id));
      const added = template.nodes.filter(n => !currentIds.has(n.id));
      if (added.length === 0) return current;
      return [...current, ...toRFNodes(added)];
    });
  }, [template.nodes.length, setNodes]);

  // Sync externally-added edges
  useEffect(() => {
    setEdges(current => {
      const currentIds = new Set(current.map(e => e.id));
      const added = template.edges.filter(e => !currentIds.has(e.id));
      if (added.length === 0) return current;
      return [...current, ...toRFEdges(added)];
    });
  }, [template.edges.length, setEdges]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const newEdges = addEdge(
          {
            ...connection,
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
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

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (selectedNodes.length === 1 && selectedNodes[0]) {
        onNodeSelect(selectedNodes[0].id);
      } else {
        onNodeSelect(null);
      }
    },
    [onNodeSelect],
  );

  return (
    <div className="h-full w-full min-h-[300px] rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1.5 },
        }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} className="!bg-card !border-border !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            switch (node.type) {
              case "agent": return "hsl(var(--primary))";
              case "condition": return "#f59e0b";
              case "checkpoint": return "#3b82f6";
              case "post-action": return "#a855f7";
              default: return "#888";
            }
          }}
        />
      </ReactFlow>
    </div>
  );
}
