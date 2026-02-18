import { useEffect, useState } from "react";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";

interface AgentState {
  name: string;
  status: string;
  stream: string;
}

export function AgentStatusPanel() {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (msg.type === "agent_status") {
        const { agentName, status } = msg.payload as { agentName: string; status: string };
        setAgents((prev) => ({
          ...prev,
          [agentName]: { ...prev[agentName]!, name: agentName, status, stream: prev[agentName]?.stream || "" },
        }));
      }
      if (msg.type === "agent_stream") {
        const { agentName, chunk } = msg.payload as { agentName: string; chunk: string };
        setAgents((prev) => ({
          ...prev,
          [agentName]: { ...prev[agentName]!, stream: (prev[agentName]?.stream || "") + chunk },
        }));
      }
      if (msg.type === "agent_error") {
        const { agentName, error } = msg.payload as { agentName: string; error: string };
        setAgents((prev) => ({
          ...prev,
          [agentName]: { ...prev[agentName]!, name: agentName, status: `error: ${error}`, stream: prev[agentName]?.stream || "" },
        }));
      }
    });

    return unsub;
  }, []);

  const activeAgents = Object.values(agents).filter(
    (a) => a.status === "running" || a.status?.startsWith("error")
  );

  if (activeAgents.length === 0) return null;

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/50">
      {activeAgents.map((agent) => (
        <div key={agent.name} className="px-4 py-2">
          <button
            onClick={() => setExpanded(expanded === agent.name ? null : agent.name)}
            className="flex items-center gap-2 text-sm w-full text-left"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                agent.status === "running"
                  ? "bg-yellow-400 animate-pulse"
                  : agent.status?.startsWith("error")
                    ? "bg-red-400"
                    : "bg-green-400"
              }`}
            />
            <span className="text-zinc-300 font-medium">{agent.name}</span>
            <span className="text-zinc-500 text-xs">{agent.status}</span>
          </button>
          {expanded === agent.name && agent.stream && (
            <pre className="mt-2 text-xs text-zinc-500 bg-zinc-950 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {agent.stream}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
