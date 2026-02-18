import { describe, test, expect, beforeAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { db, schema } from "../../src/server/db/index.ts";
import { nanoid } from "nanoid";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { createSnapshot, rollbackSnapshot, pruneSnapshots, listSnapshots } from "../../src/server/services/snapshot.ts";

describe("Snapshot Service", () => {
  let projectId: string;
  let projectPath: string;

  beforeAll(() => {
    runMigrations();

    projectId = nanoid();
    projectPath = `./projects/test-snap-${projectId}`;

    db.insert(schema.projects).values({
      id: projectId,
      name: "Snapshot Test",
      path: projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();

    // Create some test files
    mkdirSync(join(projectPath, "src"), { recursive: true });
    writeFileSync(join(projectPath, "src", "index.ts"), 'console.log("v1")', "utf-8");
    writeFileSync(join(projectPath, "README.md"), "# Test Project", "utf-8");
  });

  test("creates snapshot capturing all files", () => {
    const { id } = createSnapshot(projectId, projectPath, "v1");
    expect(id).toBeTruthy();

    const snapshots = listSnapshots(projectId);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.label).toBe("v1");
  });

  test("rollback restores files", () => {
    // Create snapshot of current state
    const { id } = createSnapshot(projectId, projectPath, "before-change");

    // Modify a file
    writeFileSync(join(projectPath, "src", "index.ts"), 'console.log("v2")', "utf-8");
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf-8")).toBe('console.log("v2")');

    // Rollback
    const success = rollbackSnapshot(id, projectPath);
    expect(success).toBe(true);

    // Verify file is restored
    expect(readFileSync(join(projectPath, "src", "index.ts"), "utf-8")).toBe('console.log("v1")');
  });

  test("rollback returns false for nonexistent snapshot", () => {
    const success = rollbackSnapshot("nonexistent-id", projectPath);
    expect(success).toBe(false);
  });

  test("pruning keeps max 10 snapshots", () => {
    // Create 12 snapshots
    for (let i = 0; i < 12; i++) {
      createSnapshot(projectId, projectPath, `snap-${i}`);
    }

    const snapshots = listSnapshots(projectId);
    expect(snapshots.length).toBeLessThanOrEqual(10);
  });

  test("snapshots are ordered by createdAt descending", () => {
    const snapshots = listSnapshots(projectId);
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i - 1]!.createdAt).toBeGreaterThanOrEqual(snapshots[i]!.createdAt);
    }
  });
});
