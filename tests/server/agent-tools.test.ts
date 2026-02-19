import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createAgentTools } from "../../src/server/agents/tools.ts";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const TEST_PROJECT_PATH = join(process.cwd(), "test-project-tools");

beforeEach(() => {
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
});

describe("createAgentTools", () => {
  test("returns correct tool keys", () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    expect(Object.keys(tools).sort()).toEqual(["list_files", "read_file", "write_file"]);
  });

  test("write_file writes to disk and returns success", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    const result = await tools.write_file.execute!(
      { path: "src/App.tsx", content: "export default function App() {}" },
      { toolCallId: "1", messages: [] } as never,
    );
    expect(result).toEqual({ success: true, path: "src/App.tsx" });
    const written = readFileSync(join(TEST_PROJECT_PATH, "src/App.tsx"), "utf-8");
    expect(written).toBe("export default function App() {}");
  });

  test("write_file tracks path in getFilesWritten", async () => {
    const { tools, getFilesWritten } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    await tools.write_file.execute!(
      { path: "a.ts", content: "a" },
      { toolCallId: "1", messages: [] } as never,
    );
    await tools.write_file.execute!(
      { path: "b.ts", content: "b" },
      { toolCallId: "2", messages: [] } as never,
    );
    expect(getFilesWritten()).toEqual(["a.ts", "b.ts"]);
  });

  test("read_file reads an existing file", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    writeFileSync(join(TEST_PROJECT_PATH, "hello.txt"), "world", "utf-8");
    const result = await tools.read_file.execute!(
      { path: "hello.txt" },
      { toolCallId: "1", messages: [] } as never,
    );
    expect(result).toEqual({ content: "world" });
  });

  test("read_file returns error for missing file", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    const result = await tools.read_file.execute!(
      { path: "nonexistent.txt" },
      { toolCallId: "1", messages: [] } as never,
    );
    expect(result).toEqual({ error: "File not found" });
  });

  test("list_files lists directory contents", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    writeFileSync(join(TEST_PROJECT_PATH, "index.ts"), "content", "utf-8");
    mkdirSync(join(TEST_PROJECT_PATH, "src"), { recursive: true });
    writeFileSync(join(TEST_PROJECT_PATH, "src/app.ts"), "content", "utf-8");
    const result = await tools.list_files.execute!(
      { directory: undefined },
      { toolCallId: "1", messages: [] } as never,
    );
    const names = (result as { files: Array<{ name: string }> }).files.map((f) => f.name);
    expect(names).toContain("index.ts");
    expect(names).toContain("src");
  });

  test("list_files lists subdirectory", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    mkdirSync(join(TEST_PROJECT_PATH, "src"), { recursive: true });
    writeFileSync(join(TEST_PROJECT_PATH, "src/app.ts"), "content", "utf-8");
    const result = await tools.list_files.execute!(
      { directory: "src" },
      { toolCallId: "1", messages: [] } as never,
    );
    const names = (result as { files: Array<{ name: string }> }).files.map((f) => f.name);
    expect(names).toContain("app.ts");
  });

  test("getFilesWritten returns a copy (not the internal array)", async () => {
    const { tools, getFilesWritten } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    await tools.write_file.execute!(
      { path: "a.ts", content: "a" },
      { toolCallId: "1", messages: [] } as never,
    );
    const snapshot = getFilesWritten();
    await tools.write_file.execute!(
      { path: "b.ts", content: "b" },
      { toolCallId: "2", messages: [] } as never,
    );
    expect(snapshot).toEqual(["a.ts"]);
    expect(getFilesWritten()).toEqual(["a.ts", "b.ts"]);
  });

  test("write_file rejects path traversal", async () => {
    const { tools } = createAgentTools(TEST_PROJECT_PATH, "proj-1");
    expect(
      tools.write_file.execute!(
        { path: "../../etc/passwd", content: "evil" },
        { toolCallId: "1", messages: [] } as never,
      ),
    ).rejects.toThrow();
  });
});
