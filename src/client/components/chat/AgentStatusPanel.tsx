import { useEffect, useState } from "react";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";

interface AgentState {
  name: string;
  displayName: string;
  status: "pending" | "running" | "completed" | "failed" | "retrying";
  stream: string;
  error?: string;
  phase?: string;
}

const PIPELINE_AGENTS: Array<{ name: string; displayName: string }> = [
  { name: "orchestrator", displayName: "Orchestrator" },
  { name: "research", displayName: "Research" },
  { name: "architect", displayName: "Architect" },
  { name: "frontend-dev", displayName: "Frontend Dev" },
  { name: "styling", displayName: "Styling" },
  { name: "qa", displayName: "QA" },
  { name: "security", displayName: "Security" },
];

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",   // ○
  running: "\u25CF",   // ●
  completed: "\u2713", // ✓
  failed: "\u2717",    // ✗
  retrying: "\u21BB",  // ↻
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-zinc-600",
  running: "text-yellow-400",
  completed: "text-green-400",
  failed: "text-red-400",
  retrying: "text-orange-400",
};

export function AgentStatusPanel() {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pipelineActive, setPipelineActive] = useState(false);

  useEffect(() => {
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (msg.type === "agent_status") {
        const { agentName, status, phase } = msg.payload as {
          agentName: string;
          status: string;
          phase?: string;
        };
        const display = PIPELINE_AGENTS.find((a) => a.name === agentName)?.displayName || agentName;

        if (status === "running" || status === "retrying") {
          setPipelineActive(true);
        }
        if (agentName === "orchestrator" && status === "completed") {
          setPipelineActive(false);
        }

        setAgents((prev) => ({
          ...prev,
          [agentName]: {
            ...prev[agentName],
            name: agentName,
            displayName: display,
            status: status as AgentState["status"],
            stream: prev[agentName]?.stream || "",
            phase,
          },
        }));
      }

      if (msg.type === "agent_stream") {
        const { agentName, chunk } = msg.payload as { agentName: string; chunk: string };
        setAgents((prev) => ({
          ...prev,
          [agentName]: {
            ...prev[agentName]!,
            stream: (prev[agentName]?.stream || "") + chunk,
          },
        }));
      }

      if (msg.type === "agent_error") {
        const { agentName, error } = msg.payload as { agentName: string; error: string };
        const display = PIPELINE_AGENTS.find((a) => a.name === agentName)?.displayName || agentName;
        setAgents((prev) => ({
          ...prev,
          [agentName]: {
            ...prev[agentName],
            name: agentName,
            displayName: display,
            status: "failed",
            stream: prev[agentName]?.stream || "",
            error,
          },
        }));
      }
    });

    return unsub;
  }, []);

  // Reset pipeline when user sends a new message
  useEffect(() => {
    const unsub = onWsMessage((msg) => {
      if (msg.type === "agent_status") {
        const { agentName, status } = msg.payload as { agentName: string; status: string };
        if (agentName === "orchestrator" && status === "running") {
          // New pipeline run — reset all agent states
          setAgents({});
          setPipelineActive(true);
        }
      }
    });
    return unsub;
  }, []);

  if (!pipelineActive && Object.keys(agents).length === 0) return null;

  const currentAgent = Object.values(agents).find((a) => a.status === "running");

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
      {/* Pipeline progress bar */}
      <div className="flex items-center gap-1 mb-2 overflow-x-auto">
        {PIPELINE_AGENTS.filter((a) => a.name !== "orchestrator").map((agent, i) => {
          const state = agents[agent.name];
          const status = state?.status || "pending";
          const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
          const icon = STATUS_ICONS[status] || STATUS_ICONS.pending;

          return (
            <div key={agent.name} className="flex items-center">
              {i > 0 && (
                <div
                  className={`w-4 h-px mx-0.5 ${
                    status === "completed" ? "bg-green-400/40" : "bg-zinc-700"
                  }`}
                />
              )}
              <button
                onClick={() => setExpanded(expanded === agent.name ? null : agent.name)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors hover:bg-zinc-800 ${
                  status === "running" ? "bg-zinc-800" : ""
                }`}
                title={state?.error || status}
              >
                <span className={`${color} ${status === "running" ? "animate-pulse" : ""}`}>
                  {icon}
                </span>
                <span className={status === "running" ? "text-zinc-200" : "text-zinc-500"}>
                  {agent.displayName}
                  {state?.phase === "remediation" && " (fixing)"}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Current activity label */}
      {currentAgent && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <span>
            <span className="text-zinc-200 font-medium">{currentAgent.displayName}</span>
            {currentAgent.phase === "remediation" ? " is fixing issues..." : " is working..."}
          </span>
        </div>
      )}

      {/* Error display */}
      {Object.values(agents)
        .filter((a) => a.status === "failed" && a.error)
        .map((a) => (
          <div key={a.name} className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-3 py-2">
            <span className="font-medium">{a.displayName}:</span> {a.error}
          </div>
        ))}

      {/* Expanded stream view */}
      {expanded && agents[expanded]?.stream && (
        <pre className="mt-2 text-xs text-zinc-500 bg-zinc-950 rounded p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {agents[expanded].stream}
        </pre>
      )}
    </div>
  );
}
