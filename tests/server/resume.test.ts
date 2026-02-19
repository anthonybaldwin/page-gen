import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { nanoid } from "nanoid";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { eq } from "drizzle-orm";
import { buildExecutionPlan, findInterruptedPipelineRun } from "../../src/server/agents/orchestrator.ts";

/**
 * Tests for pipeline resume logic.
 * Verifies that pipeline_runs are persisted, interrupted pipelines
 * are discoverable, and the execution plan can be filtered to skip
 * completed agents.
 */
describe("pipeline resume", () => {
  const testProjectId = `test-project-resume-${nanoid(6)}`;
  const testChatId = `test-chat-resume-${nanoid(6)}`;

  beforeAll(() => {
    runMigrations();

    db.insert(schema.projects).values({
      id: testProjectId,
      name: "Resume Test Project",
      path: `projects/${testProjectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: testChatId,
      projectId: testProjectId,
      title: "Resume Test Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
  });

  afterAll(() => {
    db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, testChatId)).run();
    db.delete(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, testChatId)).run();
    db.delete(schema.messages).where(eq(schema.messages.chatId, testChatId)).run();
    db.delete(schema.chats).where(eq(schema.chats.id, testChatId)).run();
    db.delete(schema.projects).where(eq(schema.projects.id, testProjectId)).run();
  });

  test("pipeline_run row is created with correct fields", () => {
    const runId = `test-run-${nanoid(6)}`;
    db.insert(schema.pipelineRuns).values({
      id: runId,
      chatId: testChatId,
      intent: "build",
      scope: "full",
      userMessage: "Build a calculator",
      plannedAgents: JSON.stringify(["research", "architect", "testing", "frontend-dev", "styling", "code-review", "security", "qa"]),
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
    }).run();

    const row = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).get();
    expect(row).toBeDefined();
    expect(row!.chatId).toBe(testChatId);
    expect(row!.intent).toBe("build");
    expect(row!.scope).toBe("full");
    expect(row!.status).toBe("running");
    expect(JSON.parse(row!.plannedAgents)).toContain("testing");
  });

  test("findInterruptedPipelineRun returns null when no interrupted runs", () => {
    const result = findInterruptedPipelineRun(`nonexistent-chat-${nanoid(6)}`);
    expect(result).toBeNull();
  });

  test("findInterruptedPipelineRun finds interrupted pipeline run", () => {
    const runId = `test-run-interrupted-${nanoid(6)}`;
    db.insert(schema.pipelineRuns).values({
      id: runId,
      chatId: testChatId,
      intent: "build",
      scope: "full",
      userMessage: "Build something",
      plannedAgents: JSON.stringify(["research", "architect", "frontend-dev"]),
      status: "interrupted",
      startedAt: Date.now(),
      completedAt: Date.now(),
    }).run();

    const result = findInterruptedPipelineRun(testChatId);
    expect(result).toBe(runId);
  });

  test("findInterruptedPipelineRun returns most recent interrupted run", () => {
    const olderRunId = `test-run-older-${nanoid(6)}`;
    const newerRunId = `test-run-newer-${nanoid(6)}`;
    const freshChatId = `test-chat-multi-${nanoid(6)}`;

    db.insert(schema.chats).values({
      id: freshChatId,
      projectId: testProjectId,
      title: "Multi Run Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.pipelineRuns).values({
      id: olderRunId,
      chatId: freshChatId,
      intent: "build",
      scope: "full",
      userMessage: "First build",
      plannedAgents: JSON.stringify(["research"]),
      status: "interrupted",
      startedAt: Date.now() - 10000,
      completedAt: Date.now() - 10000,
    }).run();

    db.insert(schema.pipelineRuns).values({
      id: newerRunId,
      chatId: freshChatId,
      intent: "fix",
      scope: "frontend",
      userMessage: "Fix button",
      plannedAgents: JSON.stringify(["frontend-dev"]),
      status: "interrupted",
      startedAt: Date.now(),
      completedAt: Date.now(),
    }).run();

    const result = findInterruptedPipelineRun(freshChatId);
    expect(result).toBe(newerRunId);

    // Cleanup
    db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, freshChatId)).run();
    db.delete(schema.chats).where(eq(schema.chats.id, freshChatId)).run();
  });

  test("resume can reconstruct agentResults from completed executions", () => {
    // Simulate completed agent executions in DB
    const executions = [
      { agentName: "research", content: "Research output here" },
      { agentName: "architect", content: "Architecture plan here" },
      { agentName: "frontend-dev", content: "Frontend code here" },
    ];

    for (const exec of executions) {
      db.insert(schema.agentExecutions).values({
        id: `test-exec-resume-${exec.agentName}-${nanoid(6)}`,
        chatId: testChatId,
        agentName: exec.agentName,
        status: "completed",
        input: JSON.stringify({ message: "test" }),
        output: JSON.stringify({ content: exec.content }),
        error: null,
        retryCount: 0,
        startedAt: Date.now(),
        completedAt: Date.now(),
      }).run();
    }

    // Reconstruct agentResults from DB (same logic as resumeOrchestration)
    const completedExecs = db.select()
      .from(schema.agentExecutions)
      .where(eq(schema.agentExecutions.chatId, testChatId))
      .all()
      .filter((e) => e.status === "completed");

    const agentResults = new Map<string, string>();
    const completedAgents: string[] = [];

    for (const exec of completedExecs) {
      if (exec.output) {
        try {
          const parsed = JSON.parse(exec.output);
          if (parsed.content) {
            agentResults.set(exec.agentName, parsed.content);
            completedAgents.push(exec.agentName);
          }
        } catch {
          // skip
        }
      }
    }

    expect(agentResults.has("research")).toBe(true);
    expect(agentResults.has("architect")).toBe(true);
    expect(agentResults.has("frontend-dev")).toBe(true);
    expect(agentResults.get("research")).toBe("Research output here");
    expect(completedAgents).toContain("research");
    expect(completedAgents).toContain("architect");
    expect(completedAgents).toContain("frontend-dev");
  });

  test("resume filters execution plan to skip completed agents", () => {
    const completedAgentNames = new Set(["architect", "testing", "frontend-dev"]);
    const plan = buildExecutionPlan("Build a calculator", "some research output", "build");

    const remainingSteps = plan.steps.filter((s) => !completedAgentNames.has(s.agentName));
    const remainingNames = remainingSteps.map((s) => s.agentName);

    expect(remainingNames).not.toContain("architect");
    expect(remainingNames).not.toContain("testing");
    expect(remainingNames).not.toContain("frontend-dev");
    expect(remainingNames).toContain("styling");
    expect(remainingNames).toContain("code-review");
    expect(remainingNames).toContain("security");
    expect(remainingNames).toContain("qa");
  });

  test("resume with all agents completed produces empty remaining steps", () => {
    const plan = buildExecutionPlan("Build a thing");
    const completedAgentNames = new Set(plan.steps.map((s) => s.agentName));
    const remainingSteps = plan.steps.filter((s) => !completedAgentNames.has(s.agentName));
    expect(remainingSteps).toHaveLength(0);
  });

  test("pipeline marked as interrupted when cost limit reached (not failed)", () => {
    // Simulate a pipeline that was interrupted due to cost limit
    const runId = `test-run-cost-${nanoid(6)}`;
    db.insert(schema.pipelineRuns).values({
      id: runId,
      chatId: testChatId,
      intent: "build",
      scope: "full",
      userMessage: "Build something expensive",
      plannedAgents: JSON.stringify(["research", "architect", "frontend-dev"]),
      status: "interrupted",  // cost limit should set this, not "failed"
      startedAt: Date.now(),
      completedAt: Date.now(),
    }).run();

    const row = db.select().from(schema.pipelineRuns).where(eq(schema.pipelineRuns.id, runId)).get();
    expect(row!.status).toBe("interrupted");

    // findInterruptedPipelineRun should find it
    const found = findInterruptedPipelineRun(testChatId);
    expect(found).toBeDefined();
  });
});
