import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface AgentUsage {
  agentName: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

export function UsageByAgent() {
  const [data, setData] = useState<AgentUsage[]>([]);

  useEffect(() => {
    api.get<AgentUsage[]>("/usage/by-agent").then(setData).catch(console.error);
  }, []);

  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No usage data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.agentName} className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <div>
            <p className="text-sm text-zinc-200 font-medium">{row.agentName}</p>
            <p className="text-xs text-zinc-500">{row.requestCount} requests</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-zinc-200">{row.totalTokens.toLocaleString()} tokens</p>
            <p className="text-xs text-green-400">${row.totalCost.toFixed(4)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
