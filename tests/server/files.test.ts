import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

describe("File Operations", () => {
  let projectId: string;

  beforeAll(async () => {
    runMigrations();

    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "File Test Project" }),
      })
    );
    const project = (await res.json()) as { id: string };
    projectId = project.id;

    // Create a test file
    const projectPath = `./projects/${projectId}`;
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "test.txt"), "hello world", "utf-8");
  });

  test("read file tree", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request(`http://localhost/api/files/tree/${projectId}`)
    );
    expect(res.status).toBe(200);
    const tree = (await res.json()) as Array<{ name: string; type: string }>;
    expect(tree.length).toBeGreaterThan(0);
  });

  test("read file content", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request(`http://localhost/api/files/read/${projectId}/src/test.txt`)
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { content: string };
    expect(data.content).toBe("hello world");
  });

  test("write file", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request(`http://localhost/api/files/write/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "src/new-file.txt", content: "new content" }),
      })
    );
    expect(res.status).toBe(200);

    // Verify the file was actually written
    const filePath = join("./projects", projectId, "src/new-file.txt");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("new content");
  });

  test("rejects path traversal", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request(`http://localhost/api/files/write/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "../../etc/passwd", content: "hacked" }),
      })
    );
    expect(res.status).toBe(403);
  });

  test("returns 404 for nonexistent file", async () => {
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(
      new Request(`http://localhost/api/files/read/${projectId}/nonexistent.txt`)
    );
    expect(res.status).toBe(404);
  });
});
