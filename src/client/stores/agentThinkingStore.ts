import { create } from "zustand";

export interface ThinkingBlock {
  id: string;
  agentName: string;
  displayName: string;
  status: "started" | "streaming" | "completed" | "failed";
  content: string;
  summary: string;
  expanded: boolean;
  startedAt: number;
}

function generateId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  research: "Research Agent",
  architect: "Architect Agent",
  "frontend-dev": "Frontend Developer",
  "backend-dev": "Backend Developer",
  styling: "Styling Agent",
  testing: "Testing Agent",
  "code-review": "Code Reviewer",
  qa: "QA Agent",
  security: "Security Reviewer",
  orchestrator: "Orchestrator",
};

interface AgentThinkingState {
  blocks: ThinkingBlock[];
  reset: () => void;
  stopAll: () => void;
  loadFromExecutions: (executions: Array<{
    agentName: string;
    status: string;
    output: string | null;
    startedAt: number;
  }>) => void;
  handleThinking: (payload: {
    agentName: string;
    displayName: string;
    status: "started" | "streaming" | "completed" | "failed";
    chunk?: string;
    summary?: string;
  }) => void;
  toggleExpanded: (blockId: string) => void;
}

export const useAgentThinkingStore = create<AgentThinkingState>((set) => ({
  blocks: [],

  reset: () => set({ blocks: [] }),

  stopAll: () =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.status === "started" || b.status === "streaming"
          ? {
              ...b,
              summary: "Stopped",
              status: "failed" as const,
              expanded: false,
            }
          : b
      ),
    })),

  loadFromExecutions: (executions) =>
    set(() => {
      // Skip the orchestrator summary execution
      const agentExecs = executions.filter(
        (e) => e.agentName !== "orchestrator"
      );
      if (agentExecs.length === 0) return { blocks: [] };

      const blocks: ThinkingBlock[] = agentExecs.map((exec) => {
        let content = "";
        let summary = "";
        if (exec.output) {
          try {
            const parsed = JSON.parse(exec.output);
            content = parsed.content || "";
            // Build summary: first sentence, max 120 chars
            const firstSentence = content.split(/[.!?\n]/)[0]?.trim() || "";
            summary = firstSentence.length > 120 ? firstSentence.slice(0, 117) + "..." : firstSentence;
          } catch {
            // ignore
          }
        }
        const status = exec.status === "completed" ? "completed"
          : exec.status === "failed" ? "failed"
          : exec.status === "running" ? "streaming"
          : "started";

        return {
          id: generateId(),
          agentName: exec.agentName,
          displayName: AGENT_DISPLAY_NAMES[exec.agentName] || exec.agentName,
          status: status as ThinkingBlock["status"],
          content,
          summary,
          expanded: false,
          startedAt: exec.startedAt,
        };
      });

      return { blocks };
    }),

  handleThinking: (payload) =>
    set((state) => {
      const { agentName, displayName, status, chunk, summary } = payload;
      const blocks = [...state.blocks];
      const idx = blocks.findIndex((b) => b.agentName === agentName);

      if (status === "started") {
        const newBlock: ThinkingBlock = {
          id: generateId(),
          agentName,
          displayName,
          status: "started",
          content: "",
          summary: "",
          expanded: true,
          startedAt: Date.now(),
        };

        if (idx !== -1) {
          const existing = blocks[idx]!;
          if (existing.status === "completed" || existing.status === "failed") {
            // Remediation case — existing block is done, append a new one
            const updated = blocks.map((b) =>
              b.expanded && b.status !== "started" && b.status !== "streaming"
                ? { ...b, expanded: false }
                : b
            );
            updated.push(newBlock);
            return { blocks: updated };
          }
          // Retry case — existing block is still in-progress, replace it
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

      // For streaming/completed/failed — find the LAST block matching agentName
      const lastIdx = blocks.findLastIndex((b) => b.agentName === agentName);
      if (lastIdx === -1) return state;
      const existing = blocks[lastIdx]!;

      if (status === "streaming") {
        blocks[lastIdx] = {
          ...existing,
          status: "streaming",
          content: existing.content + (chunk || ""),
        };
        return { blocks };
      }

      if (status === "completed") {
        blocks[lastIdx] = {
          ...existing,
          status: "completed",
          summary: summary || "",
          expanded: false,
        };
        return { blocks };
      }

      if (status === "failed") {
        blocks[lastIdx] = {
          ...existing,
          status: "failed",
          expanded: false,
        };
        return { blocks };
      }

      return state;
    }),

  toggleExpanded: (blockId) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === blockId ? { ...b, expanded: !b.expanded } : b
      ),
    })),
}));
