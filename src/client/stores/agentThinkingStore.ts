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

  handleThinking: (payload) =>
    set((state) => {
      const { agentName, displayName, status, chunk, summary } = payload;
      const blocks = [...state.blocks];
      const idx = blocks.findIndex((b) => b.agentName === agentName);

      if (status === "started") {
        // Collapse any previously expanded blocks
        const updated = blocks.map((b) =>
          b.expanded && b.status !== "started" && b.status !== "streaming"
            ? { ...b, expanded: false }
            : b
        );
        updated.push({
          agentName,
          displayName,
          status: "started",
          content: "",
          summary: "",
          expanded: true,
          startedAt: Date.now(),
        });
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
