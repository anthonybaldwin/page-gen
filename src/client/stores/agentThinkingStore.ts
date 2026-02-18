import { create } from "zustand";

export interface ThinkingBlock {
  agentName: string;
  displayName: string;
  status: "started" | "streaming" | "completed" | "failed";
  content: string;
  summary: string;
  expanded: boolean;
  startedAt: number;
}

interface AgentThinkingState {
  blocks: ThinkingBlock[];
  reset: () => void;
  stopAll: () => void;
  handleThinking: (payload: {
    agentName: string;
    displayName: string;
    status: "started" | "streaming" | "completed" | "failed";
    chunk?: string;
    summary?: string;
  }) => void;
  toggleExpanded: (agentName: string) => void;
}

export const useAgentThinkingStore = create<AgentThinkingState>((set) => ({
  blocks: [],

  reset: () => set({ blocks: [] }),

  stopAll: () =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.status === "started" || b.status === "streaming"
          ? {
              agentName: b.agentName,
              displayName: b.displayName,
              startedAt: b.startedAt,
              content: b.content,
              summary: "Stopped",
              status: "failed" as const,
              expanded: false,
            }
          : b
      ),
    })),

  handleThinking: (payload) =>
    set((state) => {
      const { agentName, displayName, status, chunk, summary } = payload;
      const blocks = [...state.blocks];
      const idx = blocks.findIndex((b) => b.agentName === agentName);

      if (status === "started") {
        const newBlock: ThinkingBlock = {
          agentName,
          displayName,
          status: "started",
          content: "",
          summary: "",
          expanded: true,
          startedAt: Date.now(),
        };

        if (idx !== -1) {
          // Agent retrying — replace existing block instead of creating duplicate
          blocks[idx] = newBlock;
          return { blocks };
        }

        // Collapse any previously expanded completed/failed blocks
        const updated = blocks.map((b) =>
          b.expanded && b.status !== "started" && b.status !== "streaming"
            ? { ...b, expanded: false }
            : b
        );
        updated.push(newBlock);
        return { blocks: updated };
      }

      if (idx === -1) return state;
      const existing = blocks[idx]!;

      if (status === "streaming") {
        blocks[idx] = {
          agentName: existing.agentName,
          displayName: existing.displayName,
          startedAt: existing.startedAt,
          summary: existing.summary,
          status: "streaming",
          content: existing.content + (chunk || ""),
          expanded: true,
        };
        return { blocks };
      }

      if (status === "completed") {
        blocks[idx] = {
          agentName: existing.agentName,
          displayName: existing.displayName,
          startedAt: existing.startedAt,
          content: existing.content,
          status: "completed",
          summary: summary || "",
          expanded: false,
        };
        return { blocks };
      }

      if (status === "failed") {
        blocks[idx] = {
          agentName: existing.agentName,
          displayName: existing.displayName,
          startedAt: existing.startedAt,
          content: existing.content,
          summary: existing.summary,
          status: "failed",
          expanded: false,
        };
        return { blocks };
      }

      return state;
    }),

  toggleExpanded: (agentName) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.agentName === agentName ? { ...b, expanded: !b.expanded } : b
      ),
    })),
}));
