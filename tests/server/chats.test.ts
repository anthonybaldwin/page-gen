import { describe, test, expect } from "bun:test";

describe("Chats API", () => {
  test("create project then chat, then list chats", async () => {
    const { app } = await import("../../src/server/index.ts");

    // Create project first
    const projRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Chat Test Project" }),
      })
    );
    const project = (await projRes.json()) as { id: string };

    // Create chat
    const chatRes = await app.fetch(
      new Request("http://localhost/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, title: "Test Chat" }),
      })
    );
    expect(chatRes.status).toBe(201);
    const chat = (await chatRes.json()) as { id: string; title: string; projectId: string };
    expect(chat.title).toBe("Test Chat");
    expect(chat.projectId).toBe(project.id);

    // List chats for project
    const listRes = await app.fetch(
      new Request(`http://localhost/api/chats?projectId=${project.id}`)
    );
    expect(listRes.status).toBe(200);
    const chats = (await listRes.json()) as Array<{ id: string }>;
    expect(chats.length).toBeGreaterThanOrEqual(1);

    // Get single chat
    const getRes = await app.fetch(new Request(`http://localhost/api/chats/${chat.id}`));
    expect(getRes.status).toBe(200);
    const retrieved = (await getRes.json()) as { id: string };
    expect(retrieved.id).toBe(chat.id);
  });
});
