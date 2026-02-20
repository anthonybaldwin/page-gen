import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { UsageByAgent } from "./UsageByAgent.tsx";
import { UsageByModel } from "./UsageByModel.tsx";
import { UsageByProvider } from "./UsageByProvider.tsx";
import { RequestLog } from "./RequestLog.tsx";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface ChatOption {
  chatId: string | null;
  chatTitle: string | null;
  projectName: string | null;
}

type Tab = "overview" | "by-model" | "by-provider" | "by-agent" | "log";
type Timeframe = "all" | "today" | "7d" | "30d";

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  "by-model": "By Model",
  "by-provider": "By Provider",
  "by-agent": "By Agent",
  log: "Request Log",
};

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  all: "All time",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

export interface UsageFilters {
  chatId?: string;
  from?: number;
  to?: number;
}

function buildFilterQuery(filters: UsageFilters): string {
  const params = new URLSearchParams();
  if (filters.chatId) params.set("chatId", filters.chatId);
  if (filters.from) params.set("from", String(filters.from));
  if (filters.to) params.set("to", String(filters.to));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function getTimeframeRange(tf: Timeframe): { from?: number; to?: number } {
  if (tf === "all") return {};
  const now = Date.now();
  const day = 86400000;
  if (tf === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime() };
  }
  if (tf === "7d") return { from: now - 7 * day };
  if (tf === "30d") return { from: now - 30 * day };
  return {};
}

interface UsageDashboardProps {
  onClose?: () => void;
}

export function UsageDashboard({ onClose }: UsageDashboardProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [chatOptions, setChatOptions] = useState<ChatOption[]>([]);
  const [selectedChat, setSelectedChat] = useState<string>("");
  const [timeframe, setTimeframe] = useState<Timeframe>("all");

  const filters: UsageFilters = {
    ...(selectedChat ? { chatId: selectedChat } : {}),
    ...getTimeframeRange(timeframe),
  };
  const filterQuery = buildFilterQuery(filters);

  // Load chat options for dropdown
  useEffect(() => {
    api.get<ChatOption[]>("/usage/chats").then(setChatOptions).catch(console.error);
  }, []);

  // Reload summary when filters change
  useEffect(() => {
    api.get<UsageSummary>(`/usage/summary${filterQuery}`).then(setSummary).catch(console.error);
  }, [filterQuery]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
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

        {/* Filter bar */}
        <div className="flex items-center gap-3 px-4 pb-3">
          <select
            value={selectedChat}
            onChange={(e) => setSelectedChat(e.target.value)}
            className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="">All chats</option>
            {chatOptions.map((opt) => (
              <option key={opt.chatId} value={opt.chatId || ""}>
                {opt.chatTitle || "Unknown"} ({opt.projectName || "?"})
              </option>
            ))}
          </select>

          <div className="flex rounded border border-zinc-700 overflow-hidden">
            {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 text-xs transition-colors ${
                  timeframe === tf
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {TIMEFRAME_LABELS[tf]}
              </button>
            ))}
          </div>

          {(selectedChat || timeframe !== "all") && (
            <button
              onClick={() => { setSelectedChat(""); setTimeframe("all"); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

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
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "by-model" && <UsageByModel filterQuery={filterQuery} />}
        {activeTab === "by-provider" && <UsageByProvider filterQuery={filterQuery} />}
        {activeTab === "by-agent" && <UsageByAgent filterQuery={filterQuery} />}
        {activeTab === "log" && <RequestLog filterQuery={filterQuery} />}
        {activeTab === "overview" && summary && (
          <p className="text-sm text-zinc-400">
            {summary.requestCount} API requests{selectedChat ? " for this chat" : " across all sessions"}.
          </p>
        )}
      </div>
    </div>
  );
}
