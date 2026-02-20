import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface ProviderUsage {
  provider: string;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  requestCount: number;
}

interface Props {
  filterQuery: string;
}

export function UsageByProvider({ filterQuery }: Props) {
  const [data, setData] = useState<ProviderUsage[]>([]);

  useEffect(() => {
    api.get<ProviderUsage[]>(`/usage/by-provider${filterQuery}`).then(setData).catch(console.error);
  }, [filterQuery]);

  if (data.length === 0) {
    return <p className="text-sm text-zinc-500">No usage data yet.</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.provider} className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2">
          <div>
            <p className="text-sm text-zinc-200 font-medium">{row.provider}</p>
            <p className="text-xs text-zinc-500">{row.requestCount} requests</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-zinc-200">{row.totalTokens.toLocaleString()} tokens</p>
            {(row.totalCacheCreationTokens > 0 || row.totalCacheReadTokens > 0) && (
              <p className="text-[10px] text-zinc-500">{row.totalCacheCreationTokens.toLocaleString()} cache write &middot; {row.totalCacheReadTokens.toLocaleString()} cache read</p>
            )}
            <p className="text-xs text-green-400">${row.totalCost.toFixed(4)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
