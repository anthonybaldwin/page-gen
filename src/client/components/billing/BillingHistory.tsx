import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface ProjectUsage {
  projectId: string | null;
  projectName: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface LedgerRecord {
  id: string;
  projectId: string | null;
  projectName: string | null;
  chatId: string | null;
  chatTitle: string | null;
  agentName: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
  createdAt: number;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function BillingHistory() {
  const [projects, setProjects] = useState<ProjectUsage[]>([]);
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<ProjectUsage[]>("/usage/by-project"),
      api.get<LedgerRecord[]>("/usage/history"),
    ])
      .then(([proj, hist]) => {
        setProjects(proj);
        setRecords(hist);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-xs text-zinc-500 p-4">Loading billing history...</p>;
  }

  const lifetimeCost = projects.reduce((sum, p) => sum + p.totalCost, 0);
  const lifetimeTokens = projects.reduce((sum, p) => sum + p.totalTokens, 0);
  const lifetimeRequests = projects.reduce((sum, p) => sum + p.requestCount, 0);

  return (
    <div>
      {/* Lifetime totals */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-xs text-zinc-500">Lifetime Cost</p>
          <p className="text-lg font-bold text-green-400">{formatCost(lifetimeCost)}</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-xs text-zinc-500">Lifetime Tokens</p>
          <p className="text-lg font-bold text-white">{lifetimeTokens.toLocaleString()}</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-xs text-zinc-500">Total Requests</p>
          <p className="text-lg font-bold text-white">{lifetimeRequests.toLocaleString()}</p>
        </div>
      </div>

      {/* Per-project breakdown */}
      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">No billing records yet.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((proj) => {
            const key = proj.projectId || "unknown";
            const isExpanded = expandedProject === key;
            const projectRecords = records.filter((r) => r.projectId === proj.projectId);

            // Group by chat within this project
            const chatGroups = new Map<string, { title: string; records: LedgerRecord[]; totalCost: number }>();
            for (const r of projectRecords) {
              const chatKey = r.chatId || "unknown";
              if (!chatGroups.has(chatKey)) {
                chatGroups.set(chatKey, { title: r.chatTitle || "Unknown Chat", records: [], totalCost: 0 });
              }
              const group = chatGroups.get(chatKey)!;
              group.records.push(r);
              group.totalCost += r.costEstimate;
            }

            return (
              <div key={key} className="rounded-lg bg-zinc-800/50 overflow-hidden">
                <button
                  onClick={() => setExpandedProject(isExpanded ? null : key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left"
                >
                  <div>
                    <span className="text-sm font-medium text-white">{proj.projectName || "Unknown Project"}</span>
                    <span className="text-xs text-zinc-500 ml-2">{proj.requestCount} requests</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-zinc-400">{proj.totalTokens.toLocaleString()} tokens</span>
                    <span className="text-sm font-medium text-green-400">{formatCost(proj.totalCost)}</span>
                    <span className="text-zinc-500">{isExpanded ? "\u25B4" : "\u25BE"}</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-700 px-4 py-2">
                    {Array.from(chatGroups.entries()).map(([chatKey, group]) => (
                      <div key={chatKey} className="py-2 border-b border-zinc-700/50 last:border-b-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-zinc-300">{group.title}</span>
                          <span className="text-xs text-green-400">{formatCost(group.totalCost)}</span>
                        </div>
                        <div className="space-y-1">
                          {group.records.map((r) => (
                            <div key={r.id} className="flex items-center justify-between text-xs text-zinc-500">
                              <div className="flex items-center gap-2">
                                <span className="text-zinc-400">{r.agentName}</span>
                                <span>{r.model}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span>{r.totalTokens.toLocaleString()} tok</span>
                                <span className="text-green-400/70">{formatCost(r.costEstimate)}</span>
                                <span className="text-zinc-600">{formatDate(r.createdAt)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
