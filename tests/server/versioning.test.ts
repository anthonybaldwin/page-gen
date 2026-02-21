import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { runMigrations } from "../../src/server/db/migrate.ts";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import {
  checkGitAvailable,
  ensureGitRepo,
  autoCommit,
  userCommit,
  listVersions,
  rollbackToVersion,
  getDiff,
} from "../../src/server/services/versioning.ts";

const TEST_PROJECT_DIR = resolve("projects/test-versioning");

describe("Git Versioning Service", () => {
  beforeAll(() => {
    runMigrations();

    // Ensure clean slate
    try {
      rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    } catch {
      // May not exist
    }

    mkdirSync(join(TEST_PROJECT_DIR, "src"), { recursive: true });
    writeFileSync(join(TEST_PROJECT_DIR, "src", "index.ts"), 'console.log("v1")', "utf-8");
    writeFileSync(join(TEST_PROJECT_DIR, "README.md"), "# Test Project", "utf-8");
  });

  afterAll(() => {
    try {
      rmSync(TEST_PROJECT_DIR, { recursive: true, force: true });
    } catch {
      // Cleanup best-effort
    }
  });

  test("git is available", () => {
    expect(checkGitAvailable()).toBe(true);
  });

  test("ensureGitRepo initializes a git repo", () => {
    const result = ensureGitRepo(TEST_PROJECT_DIR);
    expect(result).toBe(true);

    // .git directory should exist
    const { existsSync } = require("fs");
    expect(existsSync(join(TEST_PROJECT_DIR, ".git"))).toBe(true);

    // .gitignore should exist
    expect(existsSync(join(TEST_PROJECT_DIR, ".gitignore"))).toBe(true);
  });

  test("ensureGitRepo is idempotent", () => {
    const result = ensureGitRepo(TEST_PROJECT_DIR);
    expect(result).toBe(true);
  });

  test("autoCommit creates a commit and returns SHA", () => {
    // Modify a file so there's something to commit
    writeFileSync(join(TEST_PROJECT_DIR, "src", "index.ts"), 'console.log("v2")', "utf-8");

    const sha = autoCommit(TEST_PROJECT_DIR, "Update to v2");
    expect(sha).toBeTruthy();
    expect(sha!.length).toBeGreaterThanOrEqual(7);
  });

  test("autoCommit returns null when nothing changed", () => {
    const sha = autoCommit(TEST_PROJECT_DIR, "No changes");
    expect(sha).toBeNull();
  });

  test("userCommit creates a commit with user prefix", () => {
    writeFileSync(join(TEST_PROJECT_DIR, "src", "app.ts"), 'export default "app"', "utf-8");

    const sha = userCommit(TEST_PROJECT_DIR, "Added app module");
    expect(sha).toBeTruthy();
  });

  test("listVersions returns all commits", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    expect(versions.length).toBeGreaterThanOrEqual(3); // initial + auto + user

    // Most recent first
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i - 1]!.timestamp).toBeGreaterThanOrEqual(versions[i]!.timestamp);
    }

    // At least one user version
    const userVersions = versions.filter((v) => v.isUserVersion);
    expect(userVersions.length).toBeGreaterThanOrEqual(1);
  });

  test("rollback restores files to a previous version", () => {
    // Get version list to find the auto-commit (v2)
    const versions = listVersions(TEST_PROJECT_DIR);
    const autoVersion = versions.find((v) => v.message.includes("Update to v2"));
    expect(autoVersion).toBeTruthy();

    // Modify files
    writeFileSync(join(TEST_PROJECT_DIR, "src", "index.ts"), 'console.log("v3")', "utf-8");
    autoCommit(TEST_PROJECT_DIR, "Update to v3");

    // Rollback to v2
    const success = rollbackToVersion(TEST_PROJECT_DIR, autoVersion!.sha);
    expect(success).toBe(true);

    // Verify file is restored
    const content = readFileSync(join(TEST_PROJECT_DIR, "src", "index.ts"), "utf-8");
    expect(content).toBe('console.log("v2")');
  });

  test("rollback returns false for invalid SHA", () => {
    const success = rollbackToVersion(TEST_PROJECT_DIR, "invalid");
    expect(success).toBe(false);
  });

  test("rollback returns false for nonexistent SHA", () => {
    const success = rollbackToVersion(TEST_PROJECT_DIR, "0000000000000000000000000000000000000000");
    expect(success).toBe(false);
  });

  test("getDiff returns unified diff with file stats", () => {
    // Create a change and commit it
    writeFileSync(join(TEST_PROJECT_DIR, "src", "new-file.ts"), "export const x = 1;\n", "utf-8");
    const sha = autoCommit(TEST_PROJECT_DIR, "Add new file");
    expect(sha).toBeTruthy();

    const result = getDiff(TEST_PROJECT_DIR, sha!);
    expect(result).toBeTruthy();
    expect(result!.diff).toContain("new-file.ts");
    expect(result!.files.length).toBeGreaterThanOrEqual(1);

    const newFile = result!.files.find((f) => f.path.includes("new-file.ts"));
    expect(newFile).toBeTruthy();
    expect(newFile!.additions).toBeGreaterThan(0);
  });

  test("getDiff returns null for invalid SHA", () => {
    const result = getDiff(TEST_PROJECT_DIR, "not-a-sha");
    expect(result).toBeNull();
  });

  test("path sandboxing rejects traversal attempts", () => {
    expect(() => {
      ensureGitRepo("projects/../etc/passwd");
    }).toThrow(/sandbox|traversal/i);
  });
});
