import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface ProviderUsage {
  provider: string;
  model: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

export function UsageByProvider() {
  const [data, setData] = useState<ProviderUsage[]>([]);

  useEffect(() => {
    api.get<ProviderUsage[]>("/usage/by-provider").then(setData).catch(console.error);
  }, []);

  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No usage data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={`${row.provider}-${row.model}`} className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <div>
            <p className="text-sm text-zinc-200 font-medium">{row.provider}</p>
            <p className="text-xs text-zinc-500">{row.model} &middot; {row.requestCount} requests</p>
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
