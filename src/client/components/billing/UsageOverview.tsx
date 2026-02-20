import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Card, CardContent } from "../ui/card.tsx";

interface OverviewSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  requestCount: number;
}

interface AgentUsage {
  agentName: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface ProviderUsage {
  provider: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface Props {
  filterQuery: string;
  summary: OverviewSummary | null;
}

function BarSegment({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 0.5)}%` }} />
      </div>
    </div>
  );
}

export function UsageOverview({ filterQuery, summary }: Props) {
  const [agents, setAgents] = useState<AgentUsage[]>([]);
  const [providers, setProviders] = useState<ProviderUsage[]>([]);

  useEffect(() => {
    api.get<AgentUsage[]>(`/usage/by-agent${filterQuery}`).then(setAgents).catch(console.error);
    api.get<ProviderUsage[]>(`/usage/by-provider${filterQuery}`).then(setProviders).catch(console.error);
  }, [filterQuery]);

  if (!summary || summary.requestCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">No usage data yet.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Start a chat to see your token usage breakdown here.</p>
      </div>
    );
  }

  const totalCached = summary.totalCacheCreationTokens + summary.totalCacheReadTokens;
  const totalInput = summary.totalInputTokens + totalCached;
  const cacheHitRate = totalInput > 0 ? (summary.totalCacheReadTokens / totalInput) * 100 : 0;
  const avgCostPerReq = summary.requestCount > 0 ? summary.totalCost / summary.requestCount : 0;

  const topAgents = [...agents].sort((a, b) => b.totalCost - a.totalCost).slice(0, 5);
  const maxAgentCost = topAgents[0]?.totalCost || 0;

  const sortedProviders = [...providers].sort((a, b) => b.totalCost - a.totalCost);
  const maxProviderCost = sortedProviders[0]?.totalCost || 0;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Requests</p>
            <p className="text-lg font-bold text-foreground">{summary.requestCount.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Avg Cost / Request</p>
            <p className="text-lg font-bold text-foreground">${avgCostPerReq.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Cache Hit Rate</p>
            <p className="text-lg font-bold text-foreground">{cacheHitRate.toFixed(1)}%</p>
            <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${cacheHitRate}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Token distribution */}
      <Card className="shadow-none">
        <CardContent className="p-3 space-y-2.5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Token Distribution</p>
          <BarSegment label="Input (non-cached)" value={summary.totalInputTokens} max={summary.totalTokens} color="bg-blue-500" />
          <BarSegment label="Cache Read" value={summary.totalCacheReadTokens} max={summary.totalTokens} color="bg-emerald-500" />
          <BarSegment label="Cache Write" value={summary.totalCacheCreationTokens} max={summary.totalTokens} color="bg-amber-500" />
          <BarSegment label="Output" value={summary.totalOutputTokens} max={summary.totalTokens} color="bg-purple-500" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {/* Top agents by cost */}
        {topAgents.length > 0 && (
          <Card className="shadow-none">
            <CardContent className="p-3 space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-2">Top Agents by Cost</p>
              {topAgents.map((a) => {
                const pct = maxAgentCost > 0 ? (a.totalCost / maxAgentCost) * 100 : 0;
                return (
                  <div key={a.agentName} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate mr-2">{a.agentName}</span>
                      <span className="text-emerald-500 dark:text-emerald-400 whitespace-nowrap">${a.totalCost.toFixed(4)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Cost by provider */}
        {sortedProviders.length > 0 && (
          <Card className="shadow-none">
            <CardContent className="p-3 space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-2">Cost by Provider</p>
              {sortedProviders.map((p) => {
                const pct = maxProviderCost > 0 ? (p.totalCost / maxProviderCost) * 100 : 0;
                return (
                  <div key={p.provider} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{p.provider}</span>
                      <span className="text-emerald-500 dark:text-emerald-400 whitespace-nowrap">${p.totalCost.toFixed(4)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500/60" style={{ width: `${Math.max(pct, 1)}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
