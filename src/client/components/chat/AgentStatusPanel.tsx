import { useEffect, useState, useRef } from "react";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { api } from "../../lib/api.ts";

interface AgentState {
  name: string;
  displayName: string;
  status: "pending" | "running" | "completed" | "failed" | "retrying";
  stream: string;
  error?: string;
  phase?: string;
  testBadge?: { passed: number; total: number };
  startedAt?: number;
  completedAt?: number;
}

/** Returns elapsed time string like "12s" or "1m 5s" */
function formatElapsed(startedAt?: number, completedAt?: number): string {
  if (!startedAt) return "";
  const end = completedAt || Date.now();
  const seconds = Math.floor((end - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
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
  "frontend-dev-components": "Frontend Dev",
  "frontend-dev-app": "Frontend Dev (App)",
  "backend-dev": "Backend Dev",
  styling: "Styling",
  testing: "Test Planner",
  "code-review": "Code Review",
  security: "Security",
  qa: "QA",
};

/** Resolve display name for an agent, including parallel frontend-dev instances. */
function resolveDisplayName(name: string): string {
  if (AGENT_DISPLAY_NAMES[name]) return AGENT_DISPLAY_NAMES[name];
  // Match frontend-dev-N pattern (e.g., frontend-dev-1, frontend-dev-2)
  const match = name.match(/^frontend-dev-(\d+)$/);
  if (match) return `Frontend Dev ${match[1]}`;
  return name;
}

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
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick every second to update elapsed time for running agents
  useEffect(() => {
    if (pipelineActive) {
      tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [pipelineActive]);

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
            displayName: resolveDisplayName(exec.agentName),
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
            displayName: resolveDisplayName(name),
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
        const display = resolveDisplayName(agentName);

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

        setAgents((prev) => {
          const existing = prev[agentName];
          return {
            ...prev,
            [agentName]: {
              ...existing,
              name: agentName,
              displayName: display,
              status: status as AgentState["status"],
              stream: existing?.stream || "",
              phase,
              startedAt: status === "running" ? Date.now() : existing?.startedAt,
              completedAt: (status === "completed" || status === "failed") ? Date.now() : existing?.completedAt,
            },
          };
        });
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
        const display = resolveDisplayName(agentName);
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

      // Test results — attach badge to testing agent
      if (msg.type === "test_results") {
        const { passed, total } = msg.payload as { passed: number; total: number };
        setAgents((prev) => ({
          ...prev,
          testing: {
            ...prev.testing,
            name: "testing",
            displayName: AGENT_DISPLAY_NAMES.testing || "Testing",
            status: prev.testing?.status || "completed",
            stream: prev.testing?.stream || "",
            testBadge: { passed, total },
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

  const runningAgents = Object.values(agents).filter((a) => a.status === "running");

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
                  {(status === "running" || status === "completed" || status === "failed") && state?.startedAt && (
                    <span className="ml-1 text-zinc-600 font-normal">
                      ({formatElapsed(state.startedAt, status === "running" ? undefined : state?.completedAt)})
                    </span>
                  )}
                </span>
                {state?.testBadge && (
                  <span className={`ml-1 text-[10px] font-medium ${
                    state.testBadge.passed === state.testBadge.total
                      ? "text-green-400"
                      : "text-red-400"
                  }`}>
                    {state.testBadge.passed === state.testBadge.total ? "\u2713" : "\u2717"} {state.testBadge.passed}/{state.testBadge.total}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Current activity label — show all running agents */}
      {runningAgents.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          <span>
            {runningAgents.length === 1 ? (
              <>
                <span className="text-zinc-200 font-medium">{runningAgents[0]!.displayName}</span>
                {runningAgents[0]!.phase === "remediation" ? " is fixing issues..." : " is working..."}
              </>
            ) : (
              <>
                <span className="text-zinc-200 font-medium">
                  {runningAgents.map((a) => a.displayName).join(", ")}
                </span>
                {" are working in parallel..."}
              </>
            )}
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
