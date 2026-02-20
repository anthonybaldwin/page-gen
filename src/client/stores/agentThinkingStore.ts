import { create } from "zustand";
import { extractSummary } from "../../shared/summary.ts";
import type { TestDetail } from "../../shared/types.ts";

export interface TestResults {
  passed: number;
  failed: number;
  total: number;
  duration: number;
  failures: Array<{ name: string; error: string }>;
  testDetails?: TestDetail[];
  streaming?: boolean;
}

export interface ToolCallEntry {
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

export interface ThinkingBlock {
  id: string;
  agentName: string;
  displayName: string;
  status: "started" | "streaming" | "completed" | "failed";
  content: string;
  summary: string;
  expanded: boolean;
  startedAt: number;
  blockType?: "agent" | "test-results";
  testResults?: TestResults;
  toolCalls?: ToolCallEntry[];
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
  "frontend-dev-components": "Frontend Developer",
  "frontend-dev-app": "Frontend Dev (App)",
  "backend-dev": "Backend Developer",
  styling: "Styling Agent",
  testing: "Test Planner",
  "code-review": "Code Reviewer",
  qa: "QA Agent",
  security: "Security Reviewer",
  orchestrator: "Orchestrator",
};

function resolveAgentDisplayName(agentName: string): string {
  if (AGENT_DISPLAY_NAMES[agentName]) return AGENT_DISPLAY_NAMES[agentName];
  const match = agentName.match(/^frontend-dev-(\d+)$/);
  if (match) return `Frontend Dev ${match[1]}`;
  return agentName;
}

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
    toolCall?: { toolName: string; input: Record<string, unknown> };
  }) => void;
  addTestResults: (results: TestResults) => void;
  updateTestResults: (results: TestResults) => void;
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
            summary = extractSummary(content, exec.agentName);
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
          displayName: resolveAgentDisplayName(exec.agentName),
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
      const { agentName, displayName, status, chunk, summary, toolCall } = payload;
      const blocks = [...state.blocks];

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

        // Use findLastIndex to check the MOST RECENT block for this agent,
        // not the first — avoids ghost entries when build-fix/remediation
        // creates multiple blocks for the same agent name.
        const lastIdx = blocks.findLastIndex((b) => b.agentName === agentName);
        if (lastIdx !== -1) {
          const existing = blocks[lastIdx]!;
          if (existing.status === "completed" || existing.status === "failed") {
            // Remediation/build-fix case — existing block is done, append a new one
            const updated = blocks.map((b) =>
              b.expanded && b.status !== "started" && b.status !== "streaming"
                ? { ...b, expanded: false }
                : b
            );
            updated.push(newBlock);
            return { blocks: updated };
          }
          // Retry case — existing block is still in-progress, replace it
          blocks[lastIdx] = newBlock;
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
        const updatedBlock = {
          ...existing,
          status: "streaming" as const,
          content: existing.content + (chunk || ""),
        };
        if (toolCall) {
          updatedBlock.toolCalls = [
            ...(existing.toolCalls || []),
            { ...toolCall, timestamp: Date.now() },
          ];
        }
        blocks[lastIdx] = updatedBlock;
        return { blocks };
      }

      if (status === "completed") {
        blocks[lastIdx] = {
          ...existing,
          status: "completed",
          summary: summary || "",
          expanded: existing.expanded, // Preserve user's expansion state
        };
        return { blocks };
      }

      if (status === "failed") {
        blocks[lastIdx] = {
          ...existing,
          status: "failed",
          expanded: existing.expanded, // Preserve user's expansion state
        };
        return { blocks };
      }

      return state;
    }),

  addTestResults: (results) =>
    set((state) => {
      const block: ThinkingBlock = {
        id: generateId(),
        agentName: "test-results",
        displayName: "Test Results",
        status: results.streaming ? "streaming" : "completed",
        content: "",
        summary: results.streaming
          ? `Running tests... ${results.passed} passed${results.failed > 0 ? `, ${results.failed} failed` : ""}`
          : results.failed === 0
            ? `All ${results.total} tests passed`
            : `Tests: ${results.passed}/${results.total} passed, ${results.failed} failed`,
        expanded: false,
        startedAt: Date.now(),
        blockType: "test-results",
        testResults: results,
      };
      return { blocks: [...state.blocks, block] };
    }),

  updateTestResults: (results) =>
    set((state) => {
      const blocks = [...state.blocks];
      const idx = blocks.findLastIndex((b) => b.blockType === "test-results");
      if (idx === -1) return state;
      blocks[idx] = {
        ...blocks[idx]!,
        status: results.streaming ? "streaming" : "completed",
        summary: results.streaming
          ? `Running tests... ${results.passed} passed${results.failed > 0 ? `, ${results.failed} failed` : ""}`
          : results.failed === 0
            ? `All ${results.total} tests passed`
            : `Tests: ${results.passed}/${results.total} passed, ${results.failed} failed`,
        testResults: results,
      };
      return { blocks };
    }),

  toggleExpanded: (blockId) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === blockId ? { ...b, expanded: !b.expanded } : b
      ),
    })),
}));
