import { useEffect, useState, useRef } from "react";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { api } from "../../lib/api.ts";
import { getAgentActivity, getBestMultiActivity } from "../../lib/agentActivityPhrases.ts";
import { Badge } from "../ui/badge.tsx";
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Square,
} from "lucide-react";

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
  lastToolCall?: { toolName: string; input: Record<string, unknown> } | null;
}

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
  "backend-dev": "Backend Dev",
  styling: "Styling",
  testing: "Test Planner",
  "code-review": "Code Review",
  security: "Security",
  qa: "QA",
};

function resolveDisplayName(name: string): string {
  if (AGENT_DISPLAY_NAMES[name]) return AGENT_DISPLAY_NAMES[name];
  return name;
}

function StatusIcon({ status, className = "h-3.5 w-3.5" }: { status: string; className?: string }) {
  switch (status) {
    case "pending":
      return <Circle className={`${className} text-muted-foreground/40`} />;
    case "running":
      return <Loader2 className={`${className} text-amber-400 animate-spin`} />;
    case "completed":
      return <CheckCircle2 className={`${className} text-emerald-500`} />;
    case "failed":
      return <XCircle className={`${className} text-destructive`} />;
    case "retrying":
      return <RefreshCw className={`${className} text-orange-400 animate-spin`} />;
    case "stopped":
      return <Square className={`${className} text-muted-foreground`} />;
    default:
      return <Circle className={`${className} text-muted-foreground/40`} />;
  }
}

interface Props {
  chatId: string | null;
}

export function AgentStatusPanel({ chatId }: Props) {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pipelineActive, setPipelineActive] = useState(false);
  const [pipelineAgents, setPipelineAgents] = useState(DEFAULT_PIPELINE_AGENTS);
  const [, setTick] = useState(0);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);

  useEffect(() => {
    if (pipelineActive) {
      tickCountRef.current = 0;
      tickRef.current = setInterval(() => {
        setTick((t) => t + 1);
        tickCountRef.current += 1;
        if (tickCountRef.current % 3 === 0) {
          setPhraseIndex((i) => i + 1);
        }
      }, 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [pipelineActive]);

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
      const msgChatId = (msg.payload as { chatId?: string }).chatId;
      if (msgChatId !== chatId) return;

      if (msg.type === "pipeline_plan") {
        const { agents: agentNames } = msg.payload as { agents: string[] };
        if (agentNames.length === 0) {
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
        if (agentName === "orchestrator" && (status === "completed" || status === "stopped" || status === "failed")) {
          setPipelineActive(false);
        }

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
              lastToolCall: status === "running" ? null : existing?.lastToolCall,
            },
          };
        });
      }

      if (msg.type === "agent_thinking") {
        const { agentName, toolCall } = msg.payload as {
          agentName: string;
          toolCall?: { toolName: string; input: Record<string, unknown> };
        };
        if (toolCall) {
          setAgents((prev) => {
            const existing = prev[agentName];
            if (!existing) return prev;
            return {
              ...prev,
              [agentName]: { ...existing, lastToolCall: toolCall },
            };
          });
        }
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

  if (pipelineAgents.length === 0) {
    return pipelineActive ? (
      <div className="border-b border-border bg-card/50 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
          <span className="text-foreground font-medium">Thinking...</span>
        </div>
      </div>
    ) : null;
  }

  const runningAgents = Object.values(agents).filter((a) => a.status === "running");

  return (
    <div className="border-b border-border bg-card/50 px-4 py-3">
      {/* Pipeline progress bar */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {pipelineAgents.map((agent, i) => {
          const state = agents[agent.name];
          const status = state?.status || "pending";

          return (
            <div key={`${agent.name}-${i}`} className="flex items-center">
              {i > 0 && (
                <div
                  className={`w-4 h-px mx-0.5 ${
                    status === "completed" ? "bg-emerald-500/40" : "bg-border"
                  }`}
                />
              )}
              <button
                onClick={() => setExpanded(expanded === agent.name ? null : agent.name)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap transition-colors hover:bg-accent ${
                  status === "running" ? "bg-accent" : ""
                }`}
                title={state?.error || status}
              >
                <StatusIcon status={status} className="h-3 w-3" />
                <span className={status === "running" ? "text-foreground" : "text-muted-foreground"}>
                  {agent.displayName}
                  {state?.phase === "remediation" && " (fixing)"}
                  {(status === "running" || status === "completed" || status === "failed") && state?.startedAt && (
                    <span className="ml-1 text-muted-foreground/50 font-normal">
                      ({formatElapsed(state.startedAt, status === "running" ? undefined : state?.completedAt)})
                    </span>
                  )}
                </span>
                {state?.testBadge && (
                  <Badge
                    variant={state.testBadge.passed === state.testBadge.total ? "default" : "destructive"}
                    className="text-[10px] px-1 py-0 h-4 ml-1"
                  >
                    {state.testBadge.passed}/{state.testBadge.total}
                  </Badge>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Current activity label */}
      {runningAgents.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
          <span>
            <span className="text-foreground font-medium">
              {runningAgents.map((a) => a.displayName).join(", ")}
            </span>
            {" — "}
            {runningAgents.length === 1
              ? runningAgents[0]!.phase === "remediation"
                ? "Fixing issues..."
                : getAgentActivity(runningAgents[0]!.name, runningAgents[0]!.lastToolCall, phraseIndex)
              : getBestMultiActivity(
                  runningAgents.map((a) => ({ name: a.name, lastToolCall: a.lastToolCall })),
                  phraseIndex,
                )}
          </span>
        </div>
      )}

      {/* Error display */}
      {Object.values(agents)
        .filter((a) => a.status === "failed" && a.error)
        .map((a, i) => (
          <div key={`${a.name}-err-${i}`} className="mt-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
            <span className="font-medium">{a.displayName}:</span> {a.error}
          </div>
        ))}

      {/* Expanded stream view */}
      {expanded && agents[expanded]?.stream && (
        <pre className="mt-2 text-xs text-muted-foreground bg-muted rounded-md p-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
          {agents[expanded].stream}
        </pre>
      )}
    </div>
  );
}
