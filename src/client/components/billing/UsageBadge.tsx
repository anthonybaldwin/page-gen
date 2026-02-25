import { useEffect } from "react";
import { useUsageStore } from "../../stores/usageStore.ts";
import { api } from "../../lib/api.ts";

export function formatCost(cost: number): string {
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
  const projectCost = useUsageStore((s) => s.projectCost);
  const activeProjectId = useUsageStore((s) => s.activeProjectId);
  const setLifetimeCost = useUsageStore((s) => s.setLifetimeCost);
  const seedChatCost = useUsageStore((s) => s.seedChatCost);
  const seedProjectCost = useUsageStore((s) => s.seedProjectCost);

  // Seed lifetime total from billing_ledger on mount
  useEffect(() => {
    api
      .get<{ totalCost: number }>("/usage/summary")
      .then((summary) => setLifetimeCost(summary.totalCost))
      .catch((err) => console.warn("[usage] Failed to load lifetime cost:", err));
  }, [setLifetimeCost]);

  // Seed project cost from DB when active project changes
  useEffect(() => {
    if (!activeProjectId) return;
    api
      .get<{ totalCost: number }>(`/usage/summary?projectId=${activeProjectId}`)
      .then((summary) => seedProjectCost(summary.totalCost))
      .catch((err) => console.warn("[usage] Failed to load project cost:", err));
  }, [activeProjectId, seedProjectCost]);

  // Seed chat cost from DB when active chat changes
  useEffect(() => {
    if (!activeChatId) return;
    api
      .get<{ totalCost: number }>(`/usage/summary?chatId=${activeChatId}`)
      .then((summary) => seedChatCost(summary.totalCost))
      .catch((err) => console.warn("[usage] Failed to load chat cost:", err));
  }, [activeChatId, seedChatCost]);

  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Total spent</span>
        <span className="text-xs font-medium text-emerald-500 dark:text-emerald-400">{formatCost(totalCost)}</span>
      </div>
      {activeProjectId && (
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground/60">This project</span>
          <span className="text-xs text-muted-foreground">{formatCost(projectCost)}</span>
        </div>
      )}
      {activeChatId && (
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-xs text-muted-foreground/60">This chat</span>
          <span className="text-xs text-muted-foreground">{formatCost(chatCost)}</span>
        </div>
      )}
    </button>
  );
}
