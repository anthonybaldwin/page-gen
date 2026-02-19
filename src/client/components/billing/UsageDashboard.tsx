import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { UsageByAgent } from "./UsageByAgent.tsx";
import { UsageByProvider } from "./UsageByProvider.tsx";
import { RequestLog } from "./RequestLog.tsx";
import { BillingHistory } from "./BillingHistory.tsx";
import { LimitsSettings } from "./LimitsSettings.tsx";
import { ApiKeySettings } from "./ApiKeySettings.tsx";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

type Tab = "overview" | "by-agent" | "by-provider" | "log" | "history" | "limits" | "keys";

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  "by-agent": "By Agent",
  "by-provider": "By Provider",
  log: "Request Log",
  history: "History",
  limits: "Limits",
  keys: "API Keys",
};

interface UsageDashboardProps {
  onClose?: () => void;
}

export function UsageDashboard({ onClose }: UsageDashboardProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  useEffect(() => {
    api.get<UsageSummary>("/usage/summary").then(setSummary).catch(console.error);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Pinned header */}
      <div className="shrink-0 border-b border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-medium text-white">Usage Dashboard</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          )}
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-4 gap-3 px-4 pb-3">
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
        <div className="flex gap-2 px-4 border-t border-zinc-800">
          {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "by-agent" && <UsageByAgent />}
        {activeTab === "by-provider" && <UsageByProvider />}
        {activeTab === "log" && <RequestLog />}
        {activeTab === "history" && <BillingHistory />}
        {activeTab === "limits" && <LimitsSettings />}
        {activeTab === "keys" && <ApiKeySettings />}
        {activeTab === "overview" && summary && (
          <p className="text-sm text-zinc-400">
            {summary.requestCount} API requests made across all sessions.
          </p>
        )}
      </div>
    </div>
  );
}
