import { describe, test, expect } from "bun:test";

describe("Database", () => {
  test("schema imports without error", async () => {
    const schema = await import("../../src/server/db/schema.ts");
    expect(schema.projects).toBeDefined();
    expect(schema.chats).toBeDefined();
    expect(schema.messages).toBeDefined();
    expect(schema.agentExecutions).toBeDefined();
    expect(schema.tokenUsage).toBeDefined();
  });

  test("database connection works", async () => {
    const { db } = await import("../../src/server/db/index.ts");
    expect(db).toBeDefined();
  });

  test("migrations run without error", async () => {
    const { runMigrations } = await import("../../src/server/db/migrate.ts");
    expect(() => runMigrations()).not.toThrow();
  });
});
