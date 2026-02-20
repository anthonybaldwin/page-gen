import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { UsageByAgent } from "./UsageByAgent.tsx";
import { UsageByModel } from "./UsageByModel.tsx";
import { UsageByProvider } from "./UsageByProvider.tsx";
import { RequestLog } from "./RequestLog.tsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import { Button } from "../ui/button.tsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.tsx";
import { X } from "lucide-react";

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

type Timeframe = "all" | "today" | "7d" | "30d";

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
  const [chatOptions, setChatOptions] = useState<ChatOption[]>([]);
  const [selectedChat, setSelectedChat] = useState<string>("");
  const [timeframe, setTimeframe] = useState<Timeframe>("all");

  const filters: UsageFilters = {
    ...(selectedChat ? { chatId: selectedChat } : {}),
    ...getTimeframeRange(timeframe),
  };
  const filterQuery = buildFilterQuery(filters);

  useEffect(() => {
    api.get<ChatOption[]>("/usage/chats").then(setChatOptions).catch(console.error);
  }, []);

  useEffect(() => {
    api.get<UsageSummary>(`/usage/summary${filterQuery}`).then(setSummary).catch(console.error);
  }, [filterQuery]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Tabs defaultValue="overview" className="flex flex-col flex-1 min-h-0">
        {/* Pinned header */}
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-medium text-foreground">Usage Dashboard</h2>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                aria-label="Close usage dashboard"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-4 gap-3 px-4 pb-3">
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Total Tokens</p>
                  <p className="text-lg font-bold text-foreground">{summary.totalTokens.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Input Tokens</p>
                  <p className="text-lg font-bold text-foreground">{summary.totalInputTokens.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Output Tokens</p>
                  <p className="text-lg font-bold text-foreground">{summary.totalOutputTokens.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Est. Cost</p>
                  <p className="text-lg font-bold text-emerald-500 dark:text-emerald-400">${summary.totalCost.toFixed(4)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-3 px-4 pb-3">
            <Select
              value={selectedChat || "__all__"}
              onValueChange={(val) => setSelectedChat(val === "__all__" ? "" : val)}
            >
              <SelectTrigger className="h-8 text-xs max-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-xs">All chats</SelectItem>
                {chatOptions.map((opt) => (
                  <SelectItem key={opt.chatId} value={opt.chatId || "__null__"} className="text-xs">
                    {opt.chatTitle || "Unknown"} ({opt.projectName || "?"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex gap-1">
              {(Object.keys(TIMEFRAME_LABELS) as Timeframe[]).map((tf) => (
                <Button
                  key={tf}
                  variant={timeframe === tf ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setTimeframe(tf)}
                  className="h-7 text-xs px-2"
                >
                  {TIMEFRAME_LABELS[tf]}
                </Button>
              ))}
            </div>

            {(selectedChat || timeframe !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => { setSelectedChat(""); setTimeframe("all"); }}
              >
                Clear
              </Button>
            )}
          </div>

          <TabsList className="w-full justify-start rounded-none bg-transparent px-4 h-auto pb-0 gap-1 border-t border-border">
            <TabsTrigger value="overview" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="by-model" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              By Model
            </TabsTrigger>
            <TabsTrigger value="by-provider" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              By Provider
            </TabsTrigger>
            <TabsTrigger value="by-agent" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              By Agent
            </TabsTrigger>
            <TabsTrigger value="log" className="rounded-b-none data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary text-xs">
              Request Log
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Scrollable tab content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="overview" className="mt-0">
            {summary && (
              <p className="text-sm text-muted-foreground">
                {summary.requestCount} API requests{selectedChat ? " for this chat" : " across all sessions"}.
              </p>
            )}
          </TabsContent>
          <TabsContent value="by-model" className="mt-0"><UsageByModel filterQuery={filterQuery} /></TabsContent>
          <TabsContent value="by-provider" className="mt-0"><UsageByProvider filterQuery={filterQuery} /></TabsContent>
          <TabsContent value="by-agent" className="mt-0"><UsageByAgent filterQuery={filterQuery} /></TabsContent>
          <TabsContent value="log" className="mt-0"><RequestLog filterQuery={filterQuery} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
