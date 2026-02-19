import { useEffect, useState } from "react";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { api } from "../../lib/api.ts";

interface AgentState {
  name: string;
  displayName: string;
  status: "pending" | "running" | "completed" | "failed" | "retrying";
  stream: string;
  error?: string;
  phase?: string;
}

const DEFAULT_PIPELINE_AGENTS: Array<{ name: string; displayName: string }> = [
  { name: "research", displayName: "Research" },
  { name: "architect", displayName: "Architect" },
  { name: "frontend-dev", displayName: "Frontend Dev" },
  { name: "styling", displayName: "Styling" },
  { name: "code-review", displayName: "Code Review" },
  { name: "security", displayName: "Security" },
  { name: "qa", displayName: "QA" },
];

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  orchestrator: "Orchestrator",
  research: "Research",
  architect: "Architect",
  "frontend-dev": "Frontend Dev",
  "backend-dev": "Backend Dev",
  styling: "Styling",
  "code-review": "Code Review",
  security: "Security",
  qa: "QA",
};

const STATUS_ICONS: Record<string, string> = {
  pending: "\u25CB",   // ○
  running: "\u25CF",   // ●
  completed: "\u2713", // ✓
  failed: "\u2717",    // ✗
  retrying: "\u21BB",  // ↻
  stopped: "\u25A0",   // ■
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-zinc-600",
  running: "text-yellow-400",
  completed: "text-green-400",
  failed: "text-red-400",
  retrying: "text-orange-400",
  stopped: "text-zinc-400",
};

interface Props {
  chatId: string | null;
}

export function AgentStatusPanel({ chatId }: Props) {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pipelineActive, setPipelineActive] = useState(false);
  const [pipelineAgents, setPipelineAgents] = useState(DEFAULT_PIPELINE_AGENTS);

  // Reset all state and reconstruct from DB on chat change
  useEffect(() => {
    setAgents({});
    setPipelineActive(false);
    setPipelineAgents(DEFAULT_PIPELINE_AGENTS);
    setExpanded(null);

    if (!chatId) return;

    api
      .get<{ running: boolean; executions: Array<{ agentName: string; status: string }> }>(
        `/agents/status?chatId=${chatId}`
      )
      .then(({ running, executions }) => {
        if (executions.length === 0) return;

        const agentMap: Record<string, AgentState> = {};
        for (const exec of executions) {
          agentMap[exec.agentName] = {
            name: exec.agentName,
            displayName: AGENT_DISPLAY_NAMES[exec.agentName] || exec.agentName,
            status: exec.status as AgentState["status"],
            stream: "",
          };
        }
        setAgents(agentMap);
        setPipelineActive(running);
      })
      .catch(() => {});
  }, [chatId]);

  useEffect(() => {
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (!chatId) return;
      // Strict filter — only process messages for THIS chat
      const msgChatId = (msg.payload as { chatId?: string }).chatId;
      if (msgChatId !== chatId) return;

      // Dynamic pipeline plan — update which agents to display
      if (msg.type === "pipeline_plan") {
        const { agents: agentNames } = msg.payload as { agents: string[] };
        if (agentNames.length === 0) {
          // Question mode — hide the pipeline bar
          setPipelineAgents([]);
          return;
        }
        setPipelineAgents(
          agentNames.map((name) => ({
            name,
            displayName: AGENT_DISPLAY_NAMES[name] || name,
          }))
        );
        return;
      }

      if (msg.type === "agent_status") {
        const { agentName, status, phase } = msg.payload as {
          agentName: string;
          status: string;
          phase?: string;
        };
        const display = AGENT_DISPLAY_NAMES[agentName] || agentName;

        if (status === "running" || status === "retrying") {
          setPipelineActive(true);
        }
        if (agentName === "orchestrator" && (status === "completed" || status === "stopped")) {
          setPipelineActive(false);
        }

        // Reset all agent states when a new pipeline starts
        if (agentName === "orchestrator" && status === "running") {
          setAgents({});
          setPipelineActive(true);
          setPipelineAgents(DEFAULT_PIPELINE_AGENTS);
          return;
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
        const display = AGENT_DISPLAY_NAMES[agentName] || agentName;
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
  }, [chatId]);

  if (!pipelineActive && Object.keys(agents).length === 0) return null;

  // Question mode with empty pipeline — don't render the bar
  if (pipelineAgents.length === 0) {
    return pipelineActive ? (
      <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-zinc-200 font-medium">Thinking...</span>
        </div>
      </div>
    ) : null;
  }

  const currentAgent = Object.values(agents).find((a) => a.status === "running");

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
      {/* Pipeline progress bar */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {pipelineAgents.map((agent, i) => {
          const state = agents[agent.name];
          const status = state?.status || "pending";
          const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
          const icon = STATUS_ICONS[status] || STATUS_ICONS.pending;

          return (
            <div key={`${agent.name}-${i}`} className="flex items-center">
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
        .map((a, i) => (
          <div key={`${a.name}-err-${i}`} className="mt-2 text-xs text-red-400 bg-red-900/20 rounded px-3 py-2">
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
