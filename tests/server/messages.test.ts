import { describe, test, expect } from "bun:test";

describe("Messages API", () => {
  test("create and list messages for a chat", async () => {
    const { app } = await import("../../src/server/index.ts");

    // Create project + chat
    const projRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Msg Test Project" }),
      })
    );
    const project = (await projRes.json()) as { id: string };

    const chatRes = await app.fetch(
      new Request("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, title: "Msg Test Chat" }),
      })
    );
    const chat = (await chatRes.json()) as { id: string };

    // Create message
    const msgRes = await app.fetch(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          role: "user",
          content: "Build me a landing page",
        }),
      })
    );
    expect(msgRes.status).toBe(201);
    const msg = (await msgRes.json()) as { id: string; content: string; role: string };
    expect(msg.content).toBe("Build me a landing page");
    expect(msg.role).toBe("user");

    // Create assistant message
    const assistRes = await app.fetch(
      new Request("http://localhost/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: chat.id,
          role: "assistant",
          content: "I'll create a landing page for you.",
          agentName: "orchestrator",
        }),
      })
    );
    expect(assistRes.status).toBe(201);

    // List messages
    const listRes = await app.fetch(
      new Request(`http://localhost/api/messages?chatId=${chat.id}`)
    );
    expect(listRes.status).toBe(200);
    const messages = (await listRes.json()) as Array<{ id: string }>;
    expect(messages.length).toBe(2);
  });

  test("requires chatId for listing", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(new Request("http://localhost/api/messages"));
    expect(res.status).toBe(400);
  });
});
