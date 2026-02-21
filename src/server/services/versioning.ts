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
  DEFAULT_GIT_NAME,
  DEFAULT_GIT_EMAIL,
  DEFAULT_GITIGNORE,
} from "../config/versioning.ts";

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
  } catch {
    gitAvailable = false;
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
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
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

  // Extract SHA
  const sha = runGit(projectPath, ["rev-parse", "HEAD"]);
  log("versioning", `Auto-committed: ${safeMessage}`, {
    sha: sha.stdout.slice(0, 7),
  });
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

  const sha = runGit(projectPath, ["rev-parse", "HEAD"]);
  log("versioning", `User committed: ${safeLabel}`, {
    sha: sha.stdout.slice(0, 7),
  });
  return sha.stdout;
}

export interface VersionEntry {
  sha: string;
  email: string;
  message: string;
  timestamp: number;
  isUserVersion: boolean;
}

export function listVersions(projectPath: string): VersionEntry[] {
  if (!checkGitAvailable()) return [];
  if (!ensureGitRepo(projectPath)) return [];

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
): boolean {
  if (!checkGitAvailable()) return false;
  if (!ensureGitRepo(projectPath)) return false;

  // Validate SHA format (must be hex, 7-40 chars)
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    logError("versioning", `Invalid SHA format: ${sha}`);
    return false;
  }

  // Verify the SHA exists
  const verify = runGit(projectPath, ["cat-file", "-t", sha]);
  if (verify.exitCode !== 0 || verify.stdout !== "commit") {
    logError("versioning", `SHA not found or not a commit: ${sha}`);
    return false;
  }

  // Checkout files from that commit
  const checkout = runGit(projectPath, ["checkout", sha, "--", "."]);
  if (checkout.exitCode !== 0) {
    logError("versioning", `Rollback checkout failed`, checkout.stderr);
    return false;
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
    return false;
  }

  log("versioning", `Rolled back to ${shortSha}`, { projectPath });
  return true;
}

export function getDiff(
  projectPath: string,
  sha: string,
): { diff: string; files: { path: string; additions: number; deletions: number }[] } | null {
  if (!checkGitAvailable()) return null;
  if (!ensureGitRepo(projectPath)) return null;

  // Validate SHA format
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null;

  // Get unified diff vs parent
  const diff = runGit(projectPath, ["diff", `${sha}~1`, sha]);
  if (diff.exitCode !== 0) {
    // Might be the initial commit with no parent — try against empty tree
    const diffInitial = runGit(projectPath, [
      "diff",
      "4b825dc642cb6eb9a060e54bf899d15363da7b24",
      sha,
    ]);
    if (diffInitial.exitCode !== 0) return null;
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
}
