import { describe, test, expect } from "bun:test";

describe("Projects API", () => {
  test("list projects returns empty array initially", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(new Request("http://localhost/api/projects"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("create and retrieve project", async () => {
    const { app } = await import("../../src/server/index.ts");

    // Create
    const createRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Project" }),
      })
    );
    expect(createRes.status).toBe(201);
    const project = (await createRes.json()) as { id: string; name: string };
    expect(project.name).toBe("Test Project");
    expect(project.id).toBeDefined();

    // Retrieve
    const getRes = await app.fetch(
      new Request(`http://localhost/api/projects/${project.id}`)
    );
    expect(getRes.status).toBe(200);
    const retrieved = (await getRes.json()) as { id: string; name: string };
    expect(retrieved.id).toBe(project.id);
  });
});
