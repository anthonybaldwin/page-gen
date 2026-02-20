import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface LedgerRecord {
  id: string;
  agentName: string;
  provider: string;
  model: string;
  projectName: string | null;
  chatTitle: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  costEstimate: number;
  createdAt: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface Props {
  filterQuery: string;
}

export function RequestLog({ filterQuery }: Props) {
  const [records, setRecords] = useState<LedgerRecord[]>([]);

  useEffect(() => {
    api.get<LedgerRecord[]>(`/usage${filterQuery}`).then(setRecords).catch(console.error);
  }, [filterQuery]);

  if (records.length === 0) {
    return <p className="text-sm text-muted-foreground">No requests recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="pb-2 pr-3">Time</th>
            <th className="pb-2 pr-3">Agent</th>
            <th className="pb-2 pr-3">Model</th>
            <th className="pb-2 pr-3">Chat</th>
            <th className="pb-2 pr-3 text-right">Input</th>
            <th className="pb-2 pr-3 text-right">Output</th>
            <th className="pb-2 pr-3 text-right">Cache Write</th>
            <th className="pb-2 pr-3 text-right">Cache Read</th>
            <th className="pb-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b border-border/50 text-foreground">
              <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{formatTime(r.createdAt)}</td>
              <td className="py-1.5 pr-3 whitespace-nowrap">{r.agentName}</td>
              <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{r.model}</td>
              <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[120px]">{r.chatTitle || "—"}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.inputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.outputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap text-muted-foreground">{r.cacheCreationInputTokens ? r.cacheCreationInputTokens.toLocaleString() : "—"}</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap text-muted-foreground">{r.cacheReadInputTokens ? r.cacheReadInputTokens.toLocaleString() : "—"}</td>
              <td className="py-1.5 text-right text-emerald-500 dark:text-emerald-400 whitespace-nowrap">${r.costEstimate.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
