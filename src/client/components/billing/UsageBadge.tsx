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
      className="w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Total spent</span>
        <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">{formatCost(totalCost)}</span>
      </div>
      {activeChatId && chatCost > 0 && (
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground/60">This chat</span>
          <span className="text-xs text-muted-foreground">{formatCost(chatCost)}</span>
        </div>
      )}
    </button>
  );
}
