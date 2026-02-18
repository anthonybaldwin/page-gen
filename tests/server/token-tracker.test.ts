import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { nanoid } from "nanoid";
import { trackTokenUsage, getSessionTokenTotal, getUsageByAgent } from "../../src/server/services/token-tracker.ts";

describe("Token Tracker", () => {
  let projectId: string;
  let chatId: string;
  let executionId: string;

  beforeAll(() => {
    runMigrations();

    // Set up test data
    projectId = nanoid();
    chatId = nanoid();
    executionId = nanoid();

    db.insert(schema.projects).values({
      id: projectId,
      name: "Token Test",
      path: `./projects/${projectId}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.chats).values({
      id: chatId,
      projectId,
      title: "Token Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    db.insert(schema.agentExecutions).values({
      id: executionId,
      chatId,
      agentName: "research",
      status: "completed",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();
  });

  test("tracks token usage", () => {
    const record = trackTokenUsage({
      executionId,
      chatId,
      agentName: "research",
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(record.id).toBeTruthy();
    expect(record.totalTokens).toBe(150);
    expect(record.costEstimate).toBeGreaterThan(0);
    expect(record.apiKeyHash).toHaveLength(64);
  });

  test("getSessionTokenTotal returns correct total", () => {
    const total = getSessionTokenTotal(chatId);
    expect(total).toBeGreaterThanOrEqual(150);
  });

  test("getUsageByAgent returns records", () => {
    const records = getUsageByAgent(chatId);
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.agentName).toBe("research");
  });

  test("tracks multiple records", () => {
    const exec2 = nanoid();
    db.insert(schema.agentExecutions).values({
      id: exec2,
      chatId,
      agentName: "frontend-dev",
      status: "completed",
      input: JSON.stringify({}),
      startedAt: Date.now(),
    }).run();

    trackTokenUsage({
      executionId: exec2,
      chatId,
      agentName: "frontend-dev",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "test-key-2",
      inputTokens: 500,
      outputTokens: 200,
    });

    const total = getSessionTokenTotal(chatId);
    expect(total).toBeGreaterThanOrEqual(850); // 150 + 700
  });

  test("cost estimation uses model pricing", () => {
    const record = trackTokenUsage({
      executionId,
      chatId,
      agentName: "orchestrator",
      provider: "anthropic",
      model: "claude-opus-4-6",
      apiKey: "test-key",
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Opus pricing: $15/M input + $75/M output
    // Expected: (1000 * 15 + 500 * 75) / 1_000_000 = 0.0525
    expect(record.costEstimate).toBeCloseTo(0.0525, 4);
  });
});
