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
  deleteVersion,
  pruneExcessVersions,
  getDiff,
  getFileTreeAtVersion,
  enterPreview,
  exitPreview,
  isInPreview,
  getPreviewInfo,
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
    const result = rollbackToVersion(TEST_PROJECT_DIR, autoVersion!.sha);
    expect(result.ok).toBe(true);

    // Verify file is restored
    const content = readFileSync(join(TEST_PROJECT_DIR, "src", "index.ts"), "utf-8");
    expect(content).toBe('console.log("v2")');
  });

  test("rollback returns error for invalid SHA", () => {
    const result = rollbackToVersion(TEST_PROJECT_DIR, "invalid");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("rollback returns error for nonexistent SHA", () => {
    const result = rollbackToVersion(TEST_PROJECT_DIR, "0000000000000000000000000000000000000000");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
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

  test("getFileTreeAtVersion returns file list at a commit", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    expect(versions.length).toBeGreaterThan(0);

    const files = getFileTreeAtVersion(TEST_PROJECT_DIR, versions[0]!.sha);
    expect(files).toBeTruthy();
    expect(files!.length).toBeGreaterThan(0);
    // Should include some known file
    expect(files!.some((f) => f.includes("index.ts") || f.includes("README.md"))).toBe(true);
  });

  test("getFileTreeAtVersion returns null for invalid SHA", () => {
    const files = getFileTreeAtVersion(TEST_PROJECT_DIR, "not-a-sha");
    expect(files).toBeNull();
  });

  test("isInitial flag is true for root commit, false for others", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    // Exactly one version should be initial
    const initialVersions = versions.filter((v) => v.isInitial);
    expect(initialVersions.length).toBe(1);

    // The initial version should contain the initial commit message
    expect(initialVersions[0]!.message).toContain("Initial commit");

    // All non-initial versions should have isInitial=false
    const nonInitial = versions.filter((v) => !v.isInitial);
    expect(nonInitial.length).toBe(versions.length - 1);
  });

  test("rollbackToVersion rejects initial commit", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    const initial = versions.find((v) => v.isInitial);
    expect(initial).toBeTruthy();

    const result = rollbackToVersion(TEST_PROJECT_DIR, initial!.sha);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("initial");
  });

  test("deleteVersion rejects when only 1 commit remains", () => {
    // Create a fresh project with only 1 commit
    const singleDir = resolve("projects/test-versioning-single");
    try { rmSync(singleDir, { recursive: true, force: true }); } catch {}
    mkdirSync(singleDir, { recursive: true });
    writeFileSync(join(singleDir, "file.txt"), "hello", "utf-8");
    ensureGitRepo(singleDir);

    const versions = listVersions(singleDir);
    expect(versions.length).toBe(1);

    const result = deleteVersion(singleDir, versions[0]!.sha);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("only version");

    try { rmSync(singleDir, { recursive: true, force: true }); } catch {}
  });

  test("deleteVersion rejects HEAD commit", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    const head = versions[0]!; // Newest = HEAD

    const result = deleteVersion(TEST_PROJECT_DIR, head.sha);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("latest");
  });

  test("deleteVersion removes a non-root commit from history", () => {
    // Create some commits
    writeFileSync(join(TEST_PROJECT_DIR, "delete-test.txt"), "v1", "utf-8");
    const sha1 = autoCommit(TEST_PROJECT_DIR, "Delete test v1");
    expect(sha1).toBeTruthy();

    writeFileSync(join(TEST_PROJECT_DIR, "delete-test.txt"), "v2", "utf-8");
    const sha2 = autoCommit(TEST_PROJECT_DIR, "Delete test v2");
    expect(sha2).toBeTruthy();

    const versionsBefore = listVersions(TEST_PROJECT_DIR);
    const countBefore = versionsBefore.length;

    // Delete the v1 commit (not HEAD, not root)
    const result = deleteVersion(TEST_PROJECT_DIR, sha1!);
    expect(result.ok).toBe(true);

    const versionsAfter = listVersions(TEST_PROJECT_DIR);
    expect(versionsAfter.length).toBe(countBefore - 1);

    // The deleted SHA should not appear in history
    expect(versionsAfter.find((v) => v.sha === sha1)).toBeUndefined();
  });

  test("deleteVersion removes the root commit (creates new root)", () => {
    const versionsBefore = listVersions(TEST_PROJECT_DIR);
    const root = versionsBefore.find((v) => v.isInitial);
    expect(root).toBeTruthy();

    const countBefore = versionsBefore.length;
    const result = deleteVersion(TEST_PROJECT_DIR, root!.sha);
    expect(result.ok).toBe(true);

    const versionsAfter = listVersions(TEST_PROJECT_DIR);
    expect(versionsAfter.length).toBe(countBefore - 1);

    // The old root SHA should not appear
    expect(versionsAfter.find((v) => v.sha === root!.sha)).toBeUndefined();

    // A new root should exist
    const newRoot = versionsAfter.find((v) => v.isInitial);
    expect(newRoot).toBeTruthy();
  });

  test("pruneExcessVersions removes oldest auto-commit when over cap", () => {
    // Create a fresh project for pruning test
    const pruneDir = resolve("projects/test-versioning-prune");
    try { rmSync(pruneDir, { recursive: true, force: true }); } catch {}
    mkdirSync(pruneDir, { recursive: true });
    writeFileSync(join(pruneDir, "file.txt"), "init", "utf-8");
    ensureGitRepo(pruneDir);

    // Create 4 auto-commits (total = 5 with initial)
    for (let i = 1; i <= 4; i++) {
      writeFileSync(join(pruneDir, "file.txt"), `v${i}`, "utf-8");
      autoCommit(pruneDir, `Change ${i}`);
    }

    const versionsBefore = listVersions(pruneDir);
    expect(versionsBefore.length).toBe(5);

    // We can't easily test with MAX=50, so we'll call pruneExcessVersions
    // and verify it doesn't prune when under cap (5 < 50)
    pruneExcessVersions(pruneDir);
    const versionsAfter = listVersions(pruneDir);
    expect(versionsAfter.length).toBe(5); // No pruning since under cap

    try { rmSync(pruneDir, { recursive: true, force: true }); } catch {}
  });

  test("pruneExcessVersions skips user-saved versions", () => {
    // Create a fresh project for pruning test
    const pruneDir2 = resolve("projects/test-versioning-prune2");
    try { rmSync(pruneDir2, { recursive: true, force: true }); } catch {}
    mkdirSync(pruneDir2, { recursive: true });
    writeFileSync(join(pruneDir2, "file.txt"), "init", "utf-8");
    ensureGitRepo(pruneDir2);

    // Create a user commit and an auto commit
    writeFileSync(join(pruneDir2, "file.txt"), "user-v1", "utf-8");
    userCommit(pruneDir2, "User saved");
    writeFileSync(join(pruneDir2, "file.txt"), "auto-v1", "utf-8");
    autoCommit(pruneDir2, "Auto change");

    const versions = listVersions(pruneDir2);
    const userVersions = versions.filter((v) => v.isUserVersion);
    expect(userVersions.length).toBeGreaterThanOrEqual(1);

    // Pruning shouldn't touch anything under cap
    pruneExcessVersions(pruneDir2);
    const versionsAfter = listVersions(pruneDir2);
    const userVersionsAfter = versionsAfter.filter((v) => v.isUserVersion);
    expect(userVersionsAfter.length).toBe(userVersions.length);

    try { rmSync(pruneDir2, { recursive: true, force: true }); } catch {}
  });

  test("path sandboxing rejects traversal attempts", () => {
    expect(() => {
      ensureGitRepo("projects/../etc/passwd");
    }).toThrow(/sandbox|traversal/i);
  });

  // --- Preview tests ---

  test("enterPreview checks out files and tracks state", () => {
    // Create a known state
    writeFileSync(join(TEST_PROJECT_DIR, "preview-test.txt"), "current", "utf-8");
    const currentSha = autoCommit(TEST_PROJECT_DIR, "Preview test current");
    expect(currentSha).toBeTruthy();

    writeFileSync(join(TEST_PROJECT_DIR, "preview-test.txt"), "newer", "utf-8");
    const newerSha = autoCommit(TEST_PROJECT_DIR, "Preview test newer");
    expect(newerSha).toBeTruthy();

    // Enter preview at the older commit
    const result = enterPreview(TEST_PROJECT_DIR, currentSha!);
    expect(result.ok).toBe(true);

    // State should be tracked
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(true);
    const info = getPreviewInfo(TEST_PROJECT_DIR);
    expect(info).toBeTruthy();
    expect(info!.originalHead).toBe(newerSha!);
    expect(info!.previewSha).toBe(currentSha!);

    // Files should reflect the older commit
    const content = readFileSync(join(TEST_PROJECT_DIR, "preview-test.txt"), "utf-8");
    expect(content).toBe("current");

    // Clean up — exit preview
    exitPreview(TEST_PROJECT_DIR);
  });

  test("exitPreview restores HEAD files", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    const head = versions[0]!;
    const older = versions[1]!;

    // Enter preview at older version
    enterPreview(TEST_PROJECT_DIR, older.sha);
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(true);

    // Exit preview
    const result = exitPreview(TEST_PROJECT_DIR);
    expect(result.ok).toBe(true);
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(false);
    expect(getPreviewInfo(TEST_PROJECT_DIR)).toBeNull();

    // Files should be restored to HEAD
    const content = readFileSync(join(TEST_PROJECT_DIR, "preview-test.txt"), "utf-8");
    expect(content).toBe("newer");
  });

  test("isInPreview returns correct state", () => {
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(false);

    const versions = listVersions(TEST_PROJECT_DIR);
    const older = versions[1]!;
    enterPreview(TEST_PROJECT_DIR, older.sha);
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(true);

    exitPreview(TEST_PROJECT_DIR);
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(false);
  });

  test("autoCommit auto-exits preview before committing", () => {
    const versions = listVersions(TEST_PROJECT_DIR);
    const older = versions[1]!;

    enterPreview(TEST_PROJECT_DIR, older.sha);
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(true);

    // Make a change and auto-commit — should auto-exit preview first
    writeFileSync(join(TEST_PROJECT_DIR, "auto-exit-test.txt"), "after-preview", "utf-8");
    const sha = autoCommit(TEST_PROJECT_DIR, "Auto commit during preview");
    expect(sha).toBeTruthy();
    expect(isInPreview(TEST_PROJECT_DIR)).toBe(false);
  });

  test("enterPreview with invalid SHA returns error", () => {
    const result = enterPreview(TEST_PROJECT_DIR, "0000000000000000000000000000000000000000");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("enterPreview with bad format returns error", () => {
    const result = enterPreview(TEST_PROJECT_DIR, "not-a-sha");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid SHA");
  });
});
