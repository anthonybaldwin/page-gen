import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { TokenUsage } from "../../../shared/types.ts";

export function RequestLog() {
  const [records, setRecords] = useState<TokenUsage[]>([]);

  useEffect(() => {
    api.get<TokenUsage[]>("/usage").then(setRecords).catch(console.error);
  }, []);

  if (records.length === 0) {
    return <p className="text-sm text-zinc-500">No requests recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-800">
            <th className="pb-2 pr-3">Agent</th>
            <th className="pb-2 pr-3">Provider</th>
            <th className="pb-2 pr-3">Model</th>
            <th className="pb-2 pr-3 text-right">Input</th>
            <th className="pb-2 pr-3 text-right">Output</th>
            <th className="pb-2 pr-3 text-right">Total</th>
            <th className="pb-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b border-zinc-800/50 text-zinc-300">
              <td className="py-1.5 pr-3">{r.agentName}</td>
              <td className="py-1.5 pr-3">{r.provider}</td>
              <td className="py-1.5 pr-3 text-zinc-500">{r.model}</td>
              <td className="py-1.5 pr-3 text-right">{r.inputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right">{r.outputTokens.toLocaleString()}</td>
              <td className="py-1.5 pr-3 text-right">{r.totalTokens.toLocaleString()}</td>
              <td className="py-1.5 text-right text-green-400">${r.costEstimate.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
