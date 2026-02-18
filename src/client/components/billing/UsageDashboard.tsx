import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { UsageByAgent } from "./UsageByAgent.tsx";
import { UsageByProvider } from "./UsageByProvider.tsx";
import { RequestLog } from "./RequestLog.tsx";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

export function UsageDashboard() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "by-agent" | "by-provider" | "log">("overview");

  useEffect(() => {
    api.get<UsageSummary>("/usage/summary").then(setSummary).catch(console.error);
  }, []);

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-white mb-4">Token Usage</h2>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="rounded-lg bg-zinc-800 p-3">
            <p className="text-xs text-zinc-500">Total Tokens</p>
            <p className="text-lg font-bold text-white">{summary.totalTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-zinc-800 p-3">
            <p className="text-xs text-zinc-500">Input Tokens</p>
            <p className="text-lg font-bold text-white">{summary.totalInputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-zinc-800 p-3">
            <p className="text-xs text-zinc-500">Output Tokens</p>
            <p className="text-lg font-bold text-white">{summary.totalOutputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-zinc-800 p-3">
            <p className="text-xs text-zinc-500">Est. Cost</p>
            <p className="text-lg font-bold text-green-400">${summary.totalCost.toFixed(4)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-zinc-800">
        {(["overview", "by-agent", "by-provider", "log"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab
                ? "text-white border-b-2 border-blue-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab === "by-agent" ? "By Agent" : tab === "by-provider" ? "By Provider" : tab === "log" ? "Request Log" : "Overview"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "by-agent" && <UsageByAgent />}
      {activeTab === "by-provider" && <UsageByProvider />}
      {activeTab === "log" && <RequestLog />}
      {activeTab === "overview" && summary && (
        <p className="text-sm text-zinc-400">
          {summary.requestCount} API requests made across all sessions.
        </p>
      )}
    </div>
  );
}
