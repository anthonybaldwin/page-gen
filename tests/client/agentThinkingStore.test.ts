import { describe, test, expect, beforeEach } from "bun:test";
import { useAgentThinkingStore } from "../../src/client/stores/agentThinkingStore.ts";

function getStore() {
  return useAgentThinkingStore.getState();
}

describe("agentThinkingStore", () => {
  beforeEach(() => {
    getStore().reset();
  });

  describe("handleThinking — started", () => {
    test("appends new block when no existing block for agent", () => {
      getStore().handleThinking({ agentName: "research", displayName: "Research", status: "started" });
      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.agentName).toBe("research");
      expect(blocks[0]!.status).toBe("started");
      expect(blocks[0]!.id).toBeTruthy();
    });

    test("remediation: appends new block when existing is completed", () => {
      const store = getStore();
      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev", status: "completed", summary: "done" });

      // Remediation — start the same agent again
      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev (remediation)", status: "started" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.agentName).toBe("frontend-dev");
      expect(blocks[0]!.status).toBe("completed");
      expect(blocks[1]!.agentName).toBe("frontend-dev");
      expect(blocks[1]!.status).toBe("started");
      // Different IDs
      expect(blocks[0]!.id).not.toBe(blocks[1]!.id);
    });

    test("always appends when existing is failed (retry)", () => {
      const store = getStore();
      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev", status: "failed" });

      store.handleThinking({ agentName: "frontend-dev", displayName: "Frontend Dev", status: "started" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.status).toBe("failed");
      expect(blocks[1]!.status).toBe("started");
    });

    test("always appends when existing is in-progress (started)", () => {
      const store = getStore();
      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });

      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.status).toBe("started");
      expect(blocks[1]!.status).toBe("started");
    });

    test("always appends when existing is streaming", () => {
      const store = getStore();
      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });
      store.handleThinking({ agentName: "research", displayName: "Research", status: "streaming", chunk: "data" });

      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.content).toBe("data");
      expect(blocks[1]!.status).toBe("started");
      expect(blocks[1]!.content).toBe("");
    });
  });

  describe("handleThinking — streaming/completed/failed update LAST matching block", () => {
    test("streaming updates the last block for that agent", () => {
      const store = getStore();
      // First run — completed
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE", status: "completed", summary: "v1" });
      // Second run — in progress (remediation)
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE (remediation)", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE (remediation)", status: "streaming", chunk: "new data" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.content).toBe("");      // first block untouched
      expect(blocks[1]!.content).toBe("new data"); // last block updated
    });

    test("completed updates the last block for that agent", () => {
      const store = getStore();
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE", status: "completed", summary: "v1" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE (remediation)", status: "started" });
      store.handleThinking({ agentName: "frontend-dev", displayName: "FE (remediation)", status: "completed", summary: "v2" });

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.summary).toBe("v1");
      expect(blocks[1]!.summary).toBe("v2");
    });
  });

  describe("toggleExpanded", () => {
    test("toggles expanded by block ID", () => {
      const store = getStore();
      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });
      store.handleThinking({ agentName: "research", displayName: "Research", status: "completed", summary: "done" });
      store.handleThinking({ agentName: "research", displayName: "Research (re-review)", status: "started" });

      const blocks = getStore().blocks;
      const firstId = blocks[0]!.id;
      const secondId = blocks[1]!.id;

      // First block should be collapsed (auto-collapsed when new started)
      expect(getStore().blocks[0]!.expanded).toBe(false);

      // Toggle first block by ID
      store.toggleExpanded(firstId);
      expect(getStore().blocks[0]!.expanded).toBe(true);
      expect(getStore().blocks[1]!.expanded).toBe(true); // second still expanded from started

      // Toggle second block by ID
      store.toggleExpanded(secondId);
      expect(getStore().blocks[1]!.expanded).toBe(false);
      expect(getStore().blocks[0]!.expanded).toBe(true); // first still expanded
    });
  });

  describe("loadFromExecutions", () => {
    test("assigns unique IDs to loaded blocks", () => {
      const store = getStore();
      store.loadFromExecutions([
        { agentName: "research", status: "completed", output: '{"content":"hello"}', startedAt: 1000 },
        { agentName: "architect", status: "completed", output: '{"content":"world"}', startedAt: 2000 },
      ]);

      const blocks = getStore().blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.id).toBeTruthy();
      expect(blocks[1]!.id).toBeTruthy();
      expect(blocks[0]!.id).not.toBe(blocks[1]!.id);
    });

    test("includes orchestrator executions", () => {
      const store = getStore();
      store.loadFromExecutions([
        { agentName: "orchestrator", status: "completed", output: '{"content":"summary"}', startedAt: 1000 },
        { agentName: "research", status: "completed", output: '{"content":"hello"}', startedAt: 2000 },
      ]);
      expect(getStore().blocks).toHaveLength(2);
      expect(getStore().blocks[0]!.agentName).toBe("orchestrator");
      expect(getStore().blocks[1]!.agentName).toBe("research");
    });
  });

  describe("stopAll", () => {
    test("marks in-progress blocks as failed", () => {
      const store = getStore();
      store.handleThinking({ agentName: "research", displayName: "Research", status: "started" });
      store.handleThinking({ agentName: "architect", displayName: "Architect", status: "started" });
      store.handleThinking({ agentName: "architect", displayName: "Architect", status: "completed", summary: "done" });

      store.stopAll();

      const blocks = getStore().blocks;
      expect(blocks[0]!.status).toBe("failed"); // was started → now failed
      expect(blocks[0]!.summary).toBe("Stopped");
      expect(blocks[1]!.status).toBe("completed"); // was already completed → unchanged
    });
  });
});
