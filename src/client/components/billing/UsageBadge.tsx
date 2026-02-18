import { useEffect } from "react";
import { useUsageStore } from "../../stores/usageStore.ts";
import { api } from "../../lib/api.ts";

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

interface Props {
  onClick: () => void;
}

export function UsageBadge({ onClick }: Props) {
  const totalCost = useUsageStore((s) => s.totalCost);
  const chatCost = useUsageStore((s) => s.chatCost);
  const activeChatId = useUsageStore((s) => s.activeChatId);
  const setLifetimeCost = useUsageStore((s) => s.setLifetimeCost);

  // Seed lifetime total from billing_ledger on mount
  useEffect(() => {
    api
      .get<{ totalCost: number }>("/usage/summary")
      .then((summary) => setLifetimeCost(summary.totalCost))
      .catch(() => {});
  }, [setLifetimeCost]);

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 border-t border-zinc-800 text-left hover:bg-zinc-800/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">Total spent</span>
        <span className="text-xs font-medium text-green-400">{formatCost(totalCost)}</span>
      </div>
      {activeChatId && chatCost > 0 && (
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-zinc-600">This chat</span>
          <span className="text-xs text-zinc-400">{formatCost(chatCost)}</span>
        </div>
      )}
    </button>
  );
}
