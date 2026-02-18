import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";

/**
 * Integration tests covering the full flow:
 * Project creation → Chat → Messages → File CRUD → Snapshots → Usage
 */
describe("Integration: Full Orchestration Flow", () => {
  let app: { fetch: (req: Request) => Response | Promise<Response> };
  let projectId: string;
  let chatId: string;

  beforeAll(async () => {
    runMigrations();
    const mod = await import("../../src/server/index.ts");
    app = mod.app;
  });

  test("1. create project", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Integration Test Project" }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    projectId = body.id;
    expect(body.name).toBe("Integration Test Project");
  });

  test("2. create chat in project", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title: "Build a landing page" }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    chatId = body.id;
  });

  test("3. send user message", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          role: "user",
          content: "Build me a landing page with a hero section",
        }),
      })
    );
    expect(res.status).toBe(201);
  });

  test("4. send assistant response", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          role: "assistant",
          content: "I'll create a landing page with a hero section for you.",
          agentName: "orchestrator",
        }),
      })
    );
    expect(res.status).toBe(201);
  });

  test("5. verify message history", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/messages?chatId=${chatId}`)
    );
    expect(res.status).toBe(200);
    const messages = (await res.json()) as Array<{ role: string }>;
    expect(messages.length).toBe(2);
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
  });

  test("6. write file to project", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/files/write/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "src/App.tsx",
          content: 'export function App() { return <h1>Hello</h1>; }',
        }),
      })
    );
    expect(res.status).toBe(200);
  });

  test("7. read file tree", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/files/tree/${projectId}`)
    );
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{ name: string }>;
    expect(tree.length).toBeGreaterThan(0);
  });

  test("8. create snapshot", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, label: "After hero section", chatId }),
      })
    );
    expect(res.status).toBe(201);
  });

  test("9. list snapshots", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/snapshots?projectId=${projectId}`)
    );
    expect(res.status).toBe(200);
    const snaps = (await res.json()) as Array<{ label: string }>;
    expect(snaps.length).toBeGreaterThanOrEqual(1);
  });

  test("10. check usage summary", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/usage/summary")
    );
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { totalTokens: number; requestCount: number };
    expect(summary).toBeDefined();
  });

  test("11. health check", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/health")
    );
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("12. agent run without keys returns 400", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: "test" }),
      })
    );
    expect(res.status).toBe(400);
  });

  test("13. settings returns defaults", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/settings")
    );
    expect(res.status).toBe(200);
    const settings = (await res.json()) as { maxSnapshotsPerProject: number };
    expect(settings.maxSnapshotsPerProject).toBe(10);
  });

  test("14. agent executions initially empty", async () => {
    const res = await app.fetch(
      new Request(`http://localhost/api/agents/executions?chatId=${chatId}`)
    );
    expect(res.status).toBe(200);
    const execs = (await res.json()) as Array<unknown>;
    expect(Array.isArray(execs)).toBe(true);
  });
});
