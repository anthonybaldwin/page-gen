import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface AgentUsage {
  agentName: string;
  models: string;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  requestCount: number;
}

interface Props {
  filterQuery: string;
}

export function UsageByAgent({ filterQuery }: Props) {
  const [data, setData] = useState<AgentUsage[]>([]);

  useEffect(() => {
    api.get<AgentUsage[]>(`/usage/by-agent${filterQuery}`).then(setData).catch(console.error);
  }, [filterQuery]);

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No usage data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((row) => {
        const modelList = row.models ? row.models.split(",") : [];
        return (
          <div key={row.agentName} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
            <div>
              <p className="text-sm text-foreground font-medium">{row.agentName}</p>
              {modelList.length > 0 && (
                <p className="text-xs text-muted-foreground">{modelList.join(" · ")} &middot; {row.requestCount} requests</p>
              )}
              {modelList.length === 0 && (
                <p className="text-xs text-muted-foreground">{row.requestCount} requests</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm text-foreground">{row.totalTokens.toLocaleString()} tokens</p>
              {(row.totalCacheCreationTokens > 0 || row.totalCacheReadTokens > 0) && (
                <p className="text-[10px] text-muted-foreground">{row.totalCacheCreationTokens.toLocaleString()} cache write &middot; {row.totalCacheReadTokens.toLocaleString()} cache read</p>
              )}
              <p className="text-xs text-emerald-500 dark:text-emerald-400">${row.totalCost.toFixed(4)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
