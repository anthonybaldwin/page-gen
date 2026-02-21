import { resolve, normalize } from "path";
import { existsSync, writeFileSync, realpathSync, lstatSync } from "fs";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { log, logError, logWarn } from "./logger.ts";
import {
  AUTO_COMMIT_PREFIX,
  USER_COMMIT_PREFIX,
  MAX_AUTO_VERSIONS_DISPLAY,
  MAX_USER_VERSIONS_DISPLAY,
  MAX_VERSIONS_RETAINED,
  DEFAULT_GIT_NAME,
  DEFAULT_GIT_EMAIL,
  DEFAULT_GITIGNORE,
} from "../config/versioning.ts";

// --- Preview state ---
// Tracks which projects are currently in version-preview mode.
// Keyed by normalized project path.
const previewState = new Map<string, { originalHead: string; previewSha: string }>();

function normalizeKey(projectPath: string): string {
  return normalize(resolve(projectPath));
}

export function isInPreview(projectPath: string): boolean {
  return previewState.has(normalizeKey(projectPath));
}

export function getPreviewInfo(projectPath: string): { originalHead: string; previewSha: string } | null {
  return previewState.get(normalizeKey(projectPath)) ?? null;
}

export function enterPreview(
  projectPath: string,
  targetSha: string,
): { ok: boolean; error?: string } {
  if (!checkGitAvailable()) return { ok: false, error: "Git is not available" };
  if (!ensureGitRepo(projectPath)) return { ok: false, error: "Could not initialize git repo" };

  // Validate SHA format
  if (!/^[0-9a-f]{7,40}$/i.test(targetSha)) {
    return { ok: false, error: `Invalid SHA format: ${targetSha}` };
  }

  // Verify the SHA exists
  const verify = runGit(projectPath, ["cat-file", "-t", targetSha]);
  if (verify.exitCode !== 0 || verify.stdout !== "commit") {
    return { ok: false, error: "Version not found" };
  }

  const key = normalizeKey(projectPath);

  // If already in preview, reuse the original HEAD
  const existing = previewState.get(key);
  const originalHead = existing?.originalHead ?? runGit(projectPath, ["rev-parse", "HEAD"]).stdout;

  // Checkout files from target commit (does NOT move HEAD)
  const checkout = runGit(projectPath, ["checkout", targetSha, "--", "."]);
  if (checkout.exitCode !== 0) {
    return { ok: false, error: checkout.stderr || "Checkout failed" };
  }

  // Resolve full SHA for storage
  const fullSha = runGit(projectPath, ["rev-parse", targetSha]);
  previewState.set(key, { originalHead, previewSha: fullSha.stdout });

  log("versioning", `Entered preview at ${targetSha.slice(0, 7)}`, { projectPath });
  return { ok: true };
}

export function exitPreview(projectPath: string, opts?: { clean?: boolean }): { ok: boolean; error?: string } {
  const key = normalizeKey(projectPath);
  const state = previewState.get(key);
  if (!state) return { ok: true }; // Not in preview — no-op

  // Restore working tree to original HEAD
  const checkout = runGit(projectPath, ["checkout", state.originalHead, "--", "."]);
  if (checkout.exitCode !== 0) {
    logError("versioning", `exitPreview checkout failed`, checkout.stderr);
    return { ok: false, error: checkout.stderr || "Restore failed" };
  }

  // Only clean untracked files when explicitly requested (user-initiated exit).
  // Internal guards (autoCommit, orchestrator) skip this to preserve agent-written files.
  if (opts?.clean) {
    runGit(projectPath, ["clean", "-fd"]);
  }

  previewState.delete(key);
  log("versioning", `Exited preview, restored HEAD`, { projectPath });
  return { ok: true };
}

// --- Git availability cache ---

let gitAvailable: boolean | null = null;

export function checkGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;
  try {
    const result = Bun.spawnSync(["git", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    gitAvailable = result.exitCode === 0;
    if (gitAvailable) {
      log("versioning", `Git available: ${result.stdout.toString().trim()}`);
    } else {
      logWarn("versioning", `Git not available (exit code ${result.exitCode})`);
    }
  } catch {
    gitAvailable = false;
    logWarn("versioning", `Git not available (spawn failed)`);
  }
  return gitAvailable;
}

// --- Security: path sandboxing ---

const PROJECTS_ROOT = resolve("projects");

function validateProjectPath(projectPath: string): string {
  // Resolve to absolute path
  const abs = projectPath.startsWith("/") || projectPath.includes(":\\")
    ? resolve(projectPath)
    : resolve(projectPath);

  // Normalize to remove any .. traversals
  const normalized = normalize(abs);

  // Reject if path is outside projects root
  if (!normalized.startsWith(PROJECTS_ROOT)) {
    throw new Error(`Path escapes projects sandbox: ${projectPath}`);
  }

  // Reject if path contains .. components (even after normalize, for extra safety)
  if (projectPath.includes("..")) {
    throw new Error(`Path contains '..' traversal: ${projectPath}`);
  }

  // Reject symlinks that escape the sandbox
  if (existsSync(normalized)) {
    try {
      const real = realpathSync(normalized);
      if (!real.startsWith(PROJECTS_ROOT)) {
        throw new Error(`Symlink escapes projects sandbox: ${projectPath}`);
      }
    } catch (err) {
      if ((err as Error).message?.includes("sandbox")) throw err;
      // realpathSync can fail if path doesn't fully exist yet — OK
    }
  }

  return normalized;
}

// --- Security: sanitize strings for git ---

function sanitizeForGit(input: string): string {
  // Strip control characters (0x00-0x1f except \n)
  return input.replace(/[\x00-\x09\x0b-\x1f]/g, "");
}

// --- Git runner with config isolation ---

const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

function runGit(
  projectPath: string,
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const safePath = validateProjectPath(projectPath);

  const result = Bun.spawnSync(["git", ...args], {
    cwd: safePath,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: DEV_NULL,
      GIT_CONFIG_SYSTEM: DEV_NULL,
    },
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

// --- Git settings ---

export function getGitSettings(): { name: string; email: string } {
  const nameRow = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "git.user.name"))
    .get();
  const emailRow = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "git.user.email"))
    .get();

  return {
    name: nameRow?.value || DEFAULT_GIT_NAME,
    email: emailRow?.value || DEFAULT_GIT_EMAIL,
  };
}

export function setGitSettings(settings: {
  name?: string;
  email?: string;
}): void {
  if (settings.name !== undefined) {
    const key = "git.user.name";
    const value = sanitizeForGit(settings.name);
    const existing = db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, key))
      .get();
    if (existing) {
      db.update(schema.appSettings)
        .set({ value })
        .where(eq(schema.appSettings.key, key))
        .run();
    } else {
      db.insert(schema.appSettings).values({ key, value }).run();
    }
  }

  if (settings.email !== undefined) {
    const key = "git.user.email";
    const value = sanitizeForGit(settings.email);
    const existing = db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, key))
      .get();
    if (existing) {
      db.update(schema.appSettings)
        .set({ value })
        .where(eq(schema.appSettings.key, key))
        .run();
    } else {
      db.insert(schema.appSettings).values({ key, value }).run();
    }
  }
}

// --- Core operations ---

export function ensureGitRepo(projectPath: string): boolean {
  if (!checkGitAvailable()) return false;

  const safePath = validateProjectPath(projectPath);

  // Already a git repo?
  if (existsSync(resolve(safePath, ".git"))) return true;

  // git init
  const init = runGit(projectPath, ["init"]);
  if (init.exitCode !== 0) {
    logError("versioning", `git init failed`, init.stderr);
    return false;
  }

  // Set local user config
  const settings = getGitSettings();
  runGit(projectPath, ["config", "user.name", sanitizeForGit(settings.name)]);
  runGit(projectPath, [
    "config",
    "user.email",
    sanitizeForGit(settings.email),
  ]);

  // Create .gitignore
  const gitignorePath = resolve(safePath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, DEFAULT_GITIGNORE, "utf-8");
  }

  // Initial commit
  runGit(projectPath, ["add", "-A"]);
  const commit = runGit(projectPath, [
    "commit",
    "-m",
    `${AUTO_COMMIT_PREFIX} Initial commit`,
    "--allow-empty",
  ]);

  if (commit.exitCode !== 0 && !commit.stderr.includes("nothing to commit")) {
    logError("versioning", `Initial commit failed`, commit.stderr);
    return false;
  }

  log("versioning", `Initialized git repo`, { path: projectPath });
  return true;
}

export function autoCommit(
  projectPath: string,
  message: string,
): string | null {
  if (!checkGitAvailable()) return null;
  if (!ensureGitRepo(projectPath)) return null;

  // Auto-exit preview before committing
  if (isInPreview(projectPath)) {
    exitPreview(projectPath);
  }

  const safeMessage = sanitizeForGit(message);

  // Stage all changes
  runGit(projectPath, ["add", "-A"]);

  // Check if there are changes to commit
  const status = runGit(projectPath, ["status", "--porcelain"]);
  if (!status.stdout) return null; // Nothing to commit

  const commit = runGit(projectPath, [
    "commit",
    "-m",
    `${AUTO_COMMIT_PREFIX} ${safeMessage}`,
  ]);

  if (commit.exitCode !== 0) {
    if (commit.stderr.includes("nothing to commit")) return null;
    logError("versioning", `Auto-commit failed`, commit.stderr);
    return null;
  }

  log("versioning", `Auto-committed: ${safeMessage}`);

  // Auto-rotate: prune oldest versions if over cap
  // Must re-read HEAD after pruning — deleteVersion rebuilds all SHAs
  pruneExcessVersions(projectPath);

  const sha = runGit(projectPath, ["rev-parse", "HEAD"]);
  return sha.stdout;
}

export function userCommit(
  projectPath: string,
  label: string,
): string | null {
  if (!checkGitAvailable()) return null;
  if (!ensureGitRepo(projectPath)) return null;

  const safeLabel = sanitizeForGit(label);

  // Stage all changes
  runGit(projectPath, ["add", "-A"]);

  // Check if there are changes to commit
  const status = runGit(projectPath, ["status", "--porcelain"]);
  if (!status.stdout) return null; // Nothing to commit

  const commit = runGit(projectPath, [
    "commit",
    "-m",
    `${USER_COMMIT_PREFIX} ${safeLabel}`,
  ]);

  if (commit.exitCode !== 0) {
    if (commit.stderr.includes("nothing to commit")) return null;
    logError("versioning", `User commit failed`, commit.stderr);
    return null;
  }

  log("versioning", `User committed: ${safeLabel}`);

  // Auto-rotate: prune oldest versions if over cap
  // Must re-read HEAD after pruning — deleteVersion rebuilds all SHAs
  pruneExcessVersions(projectPath);

  const sha = runGit(projectPath, ["rev-parse", "HEAD"]);
  return sha.stdout;
}

export interface VersionEntry {
  sha: string;
  email: string;
  message: string;
  timestamp: number;
  isUserVersion: boolean;
  isInitial: boolean;
}

export function listVersions(projectPath: string): VersionEntry[] {
  if (!checkGitAvailable()) {
    logWarn("versioning", `listVersions skipped: git unavailable`);
    return [];
  }
  if (!ensureGitRepo(projectPath)) {
    logError("versioning", `listVersions skipped: repo init failed`, { projectPath });
    return [];
  }

  // Find root commit SHA
  const rootResult = runGit(projectPath, ["rev-list", "--max-parents=0", "HEAD"]);
  const rootSha = rootResult.exitCode === 0 ? rootResult.stdout.split("\n")[0]?.trim() : "";

  const result = runGit(projectPath, [
    "log",
    "--format=%H|%ae|%s|%at",
  ]);

  if (result.exitCode !== 0 || !result.stdout) return [];

  const lines = result.stdout.split("\n").filter(Boolean);
  const autoVersions: VersionEntry[] = [];
  const userVersions: VersionEntry[] = [];

  for (const line of lines) {
    const [sha, email, message, timestampStr] = line.split("|");
    if (!sha || !message) continue;

    const isUser = message.startsWith(USER_COMMIT_PREFIX);
    const entry: VersionEntry = {
      sha,
      email: email || "",
      message,
      timestamp: parseInt(timestampStr || "0", 10),
      isUserVersion: isUser,
      isInitial: sha === rootSha,
    };

    if (isUser) {
      if (userVersions.length < MAX_USER_VERSIONS_DISPLAY) {
        userVersions.push(entry);
      }
    } else {
      if (autoVersions.length < MAX_AUTO_VERSIONS_DISPLAY) {
        autoVersions.push(entry);
      }
    }

    // Stop if we've hit both caps
    if (
      autoVersions.length >= MAX_AUTO_VERSIONS_DISPLAY &&
      userVersions.length >= MAX_USER_VERSIONS_DISPLAY
    ) {
      break;
    }
  }

  // Merge and sort by timestamp descending
  const all = [...autoVersions, ...userVersions];
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all;
}

export function rollbackToVersion(
  projectPath: string,
  sha: string,
): { ok: boolean; error?: string } {
  if (!checkGitAvailable()) return { ok: false, error: "Git is not available" };
  if (!ensureGitRepo(projectPath)) return { ok: false, error: "Could not initialize git repo" };

  // Validate SHA format (must be hex, 7-40 chars)
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    logError("versioning", `Invalid SHA format: ${sha}`);
    return { ok: false, error: `Invalid SHA format: ${sha}` };
  }

  // Verify the SHA exists
  const verify = runGit(projectPath, ["cat-file", "-t", sha]);
  if (verify.exitCode !== 0 || verify.stdout !== "commit") {
    logError("versioning", `SHA not found or not a commit: ${sha}`);
    return { ok: false, error: "Version not found" };
  }

  // Reject rollback to initial commit (no parent to diff against)
  const rootResult = runGit(projectPath, ["rev-list", "--max-parents=0", "HEAD"]);
  if (rootResult.exitCode === 0) {
    const rootSha = rootResult.stdout.split("\n")[0]?.trim();
    if (rootSha && sha.startsWith(rootSha.slice(0, sha.length))) {
      // Resolve short SHA to full for accurate comparison
      const fullSha = runGit(projectPath, ["rev-parse", sha]);
      if (fullSha.exitCode === 0 && fullSha.stdout === rootSha) {
        return { ok: false, error: "Cannot roll back to the initial version" };
      }
    }
  }

  // Checkout files from that commit
  const checkout = runGit(projectPath, ["checkout", sha, "--", "."]);
  if (checkout.exitCode !== 0) {
    logError("versioning", `Rollback checkout failed`, checkout.stderr);
    return { ok: false, error: checkout.stderr || "Checkout failed" };
  }

  // Stage and commit the rollback
  runGit(projectPath, ["add", "-A"]);
  const shortSha = sha.slice(0, 7);
  const commit = runGit(projectPath, [
    "commit",
    "-m",
    `${AUTO_COMMIT_PREFIX} Reverted to ${shortSha}`,
  ]);

  if (commit.exitCode !== 0 && !commit.stderr.includes("nothing to commit")) {
    logError("versioning", `Rollback commit failed`, commit.stderr);
    return { ok: false, error: commit.stderr || "Commit failed after rollback" };
  }

  log("versioning", `Rolled back to ${shortSha}`, { projectPath });
  return { ok: true };
}

export function getDiff(
  projectPath: string,
  sha: string,
): { diff: string; files: { path: string; additions: number; deletions: number }[] } | null {
  if (!checkGitAvailable()) return null;
  if (!ensureGitRepo(projectPath)) return null;

  // Validate SHA format
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    logError("versioning", `getDiff: invalid SHA format: ${sha}`);
    return null;
  }

  // Get unified diff vs parent
  const diff = runGit(projectPath, ["diff", `${sha}~1`, sha]);
  if (diff.exitCode !== 0) {
    // Might be the initial commit with no parent — try against empty tree
    const diffInitial = runGit(projectPath, [
      "diff",
      "4b825dc642cb6eb9a060e54bf899d15363da7b24",
      sha,
    ]);
    if (diffInitial.exitCode !== 0) {
      logError("versioning", `getDiff failed for ${sha.slice(0, 7)}`, diffInitial.stderr);
      return null;
    }
    return parseDiff(diffInitial.stdout);
  }

  return parseDiff(diff.stdout);
}

function parseDiff(rawDiff: string): {
  diff: string;
  files: { path: string; additions: number; deletions: number }[];
} {
  const files: { path: string; additions: number; deletions: number }[] = [];
  let currentFile: string | null = null;
  let additions = 0;
  let deletions = 0;

  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("diff --git")) {
      // Save previous file stats
      if (currentFile) {
        files.push({ path: currentFile, additions, deletions });
      }
      // Parse file path from "diff --git a/path b/path"
      const match = line.match(/diff --git a\/(.+) b\//);
      currentFile = match?.[1] || null;
      additions = 0;
      deletions = 0;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }

  // Don't forget the last file
  if (currentFile) {
    files.push({ path: currentFile, additions, deletions });
  }

  return { diff: rawDiff, files };
}

export function getFileTreeAtVersion(
  projectPath: string,
  sha: string,
): string[] | null {
  if (!checkGitAvailable()) return null;
  if (!ensureGitRepo(projectPath)) return null;

  // Validate SHA format
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;

  const result = runGit(projectPath, ["ls-tree", "-r", "--name-only", sha]);
  if (result.exitCode !== 0) {
    logError("versioning", `ls-tree failed for ${sha}`, result.stderr);
    return null;
  }

  if (!result.stdout) return [];

  return result.stdout.split("\n").filter(Boolean).sort();
}

export function deleteVersion(
  projectPath: string,
  sha: string,
): { ok: boolean; error?: string } {
  if (!checkGitAvailable()) return { ok: false, error: "Git is not available" };
  if (!ensureGitRepo(projectPath)) return { ok: false, error: "Could not initialize git repo" };

  // Validate SHA format
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    return { ok: false, error: `Invalid SHA format: ${sha}` };
  }

  // Resolve to full SHA
  const resolvedSha = runGit(projectPath, ["rev-parse", sha]);
  if (resolvedSha.exitCode !== 0) {
    return { ok: false, error: "Version not found" };
  }
  const fullSha = resolvedSha.stdout;

  // Count total commits
  const countResult = runGit(projectPath, ["rev-list", "--count", "HEAD"]);
  const totalCommits = parseInt(countResult.stdout || "0", 10);
  if (totalCommits <= 1) {
    return { ok: false, error: "Cannot delete the only version" };
  }

  // Reject deleting HEAD
  const headResult = runGit(projectPath, ["rev-parse", "HEAD"]);
  if (headResult.exitCode === 0 && headResult.stdout === fullSha) {
    return { ok: false, error: "Cannot delete the latest version" };
  }

  // Reconstruct history using commit-tree, skipping the deleted commit.
  // Each commit's tree (full snapshot) is preserved — no diffs/rebasing needed.
  const logResult = runGit(projectPath, ["log", "--reverse", "--format=%H"]);
  if (logResult.exitCode !== 0 || !logResult.stdout) {
    return { ok: false, error: "Failed to read commit history" };
  }

  const allShas = logResult.stdout.split("\n").filter(Boolean);
  const kept = allShas.filter((s) => s !== fullSha);
  if (kept.length === 0) {
    return { ok: false, error: "Cannot delete all commits" };
  }

  // Rebuild chain: for each kept commit, create a new commit with same tree+message
  let prevNewSha: string | null = null;
  for (const oldSha of kept) {
    const tree = runGit(projectPath, ["rev-parse", `${oldSha}^{tree}`]);
    if (tree.exitCode !== 0) {
      return { ok: false, error: `Failed to read tree for ${oldSha.slice(0, 7)}` };
    }

    const msg = runGit(projectPath, ["log", "-1", "--format=%B", oldSha]);
    if (msg.exitCode !== 0) {
      return { ok: false, error: `Failed to read message for ${oldSha.slice(0, 7)}` };
    }

    const commitArgs = ["commit-tree", tree.stdout, "-m", msg.stdout];
    if (prevNewSha) {
      commitArgs.push("-p", prevNewSha);
    }

    const newCommit = runGit(projectPath, commitArgs);
    if (newCommit.exitCode !== 0) {
      return { ok: false, error: `Failed to create commit: ${newCommit.stderr}` };
    }
    prevNewSha = newCommit.stdout;
  }

  // Point HEAD at the new chain
  const reset = runGit(projectPath, ["reset", "--hard", prevNewSha!]);
  if (reset.exitCode !== 0) {
    return { ok: false, error: `Reset failed: ${reset.stderr}` };
  }

  // Reclaim disk space
  runGit(projectPath, ["reflog", "expire", "--expire=now", "--all"]);
  runGit(projectPath, ["gc", "--prune=now"]);

  log("versioning", `Deleted version ${fullSha.slice(0, 7)}`, { projectPath });
  return { ok: true };
}

export function pruneExcessVersions(projectPath: string): void {
  if (!checkGitAvailable()) return;

  const countResult = runGit(projectPath, ["rev-list", "--count", "HEAD"]);
  let totalCommits = parseInt(countResult.stdout || "0", 10);

  while (totalCommits > MAX_VERSIONS_RETAINED) {
    // Walk oldest-first, find first auto-commit to prune
    const logResult = runGit(projectPath, ["log", "--reverse", "--format=%H|%s"]);
    if (logResult.exitCode !== 0 || !logResult.stdout) break;

    const lines = logResult.stdout.split("\n").filter(Boolean);
    const headResult = runGit(projectPath, ["rev-parse", "HEAD"]);
    const headSha = headResult.exitCode === 0 ? headResult.stdout : "";

    let targetSha: string | null = null;

    // First pass: find oldest auto-commit (not HEAD)
    for (const line of lines) {
      const pipeIdx = line.indexOf("|");
      const sha = line.slice(0, pipeIdx);
      const msg = line.slice(pipeIdx + 1);
      if (sha === headSha) continue; // Never prune HEAD
      if (msg.startsWith(AUTO_COMMIT_PREFIX)) {
        targetSha = sha;
        break;
      }
    }

    // Fallback: if all versions are user-saved, prune absolute oldest (not HEAD)
    if (!targetSha) {
      for (const line of lines) {
        const pipeIdx = line.indexOf("|");
        const sha = line.slice(0, pipeIdx);
        if (sha === headSha) continue;
        targetSha = sha;
        break;
      }
    }

    if (!targetSha) break; // Nothing prunable

    const result = deleteVersion(projectPath, targetSha);
    if (!result.ok) {
      logWarn("versioning", `Pruning failed for ${targetSha.slice(0, 7)}: ${result.error}`);
      break;
    }

    log("versioning", `Pruned version ${targetSha.slice(0, 7)} (auto-rotation)`, { projectPath });

    // Recount
    const recount = runGit(projectPath, ["rev-list", "--count", "HEAD"]);
    totalCommits = parseInt(recount.stdout || "0", 10);
  }
}

export function applyGitConfig(projectPath: string): void {
  if (!checkGitAvailable()) return;

  const safePath = validateProjectPath(projectPath);
  if (!existsSync(resolve(safePath, ".git"))) return;

  const settings = getGitSettings();
  runGit(projectPath, ["config", "user.name", sanitizeForGit(settings.name)]);
  runGit(projectPath, [
    "config",
    "user.email",
    sanitizeForGit(settings.email),
  ]);
  log("versioning", `Applied git config`, { projectPath, name: settings.name, email: settings.email });
}
