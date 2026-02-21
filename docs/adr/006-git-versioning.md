# ADR-006: Git-Based Versioning

## Status
Accepted

## Date
2026-02-21

## Context

The original snapshot system stored complete file manifests as JSON blobs in SQLite (`snapshots` table). Each snapshot contained a `file_manifest` column mapping every file path to its full content. This approach had several issues:

1. **Storage bloat** — Each snapshot duplicated the entire project, growing linearly with snapshot count and project size.
2. **No diffing** — The only way to compare snapshots was full manifest comparison. No unified diff, no line-level changes.
3. **No path to GitHub** — The planned GitHub integration (`plans/repo-and-hosting.md`) requires git. Snapshots would need a separate migration layer.
4. **No incremental history** — Snapshots were coarse-grained (manual or per-pipeline). No visibility into what changed between agent steps.

## Decisions

### 1. Git as the Version Backend

Each project directory is a git repository. Version operations map directly to git commands:

| Operation | Old (SQLite) | New (git) |
|-----------|-------------|-----------|
| Create version | `INSERT INTO snapshots (file_manifest)` | `git add -A && git commit` |
| List versions | `SELECT FROM snapshots` | `git log` |
| Rollback | Clear files, write manifest | `git checkout <sha> -- .` |
| Diff | N/A | `git diff <sha>~1 <sha>` |

**Key file:** `src/server/services/versioning.ts`

### 2. Security Hardening

All git commands run server-side via `Bun.spawnSync` with array args (never shell strings), preventing command injection. Additional layers:

- **Path sandboxing** — `validateProjectPath()` resolves paths and rejects anything outside `projects/`. Checks for `..` traversal and symlinks escaping the sandbox.
- **Config isolation** — Every `runGit()` call sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` to block `.gitconfig` poisoning.
- **Input sanitization** — `sanitizeForGit()` strips control characters (`\x00`-`\x1f` except `\n`) from commit messages and config values.
- **`.gitignore` defaults** — Auto-created with `node_modules/`, `.env`, `.env.*`, `*.pem`, `credentials*`.

### 3. Automatic Stage Hooks

The orchestrator auto-commits at pipeline stage boundaries:

- **After each batch** — When a set of concurrent agents completes, auto-commit with label `"After <agent names>"`.
- **Pipeline completion** — Final auto-commit with `"Pipeline completed"` (or `"Pipeline completed (with errors)"`).

This gives users automatic rollback points at every pipeline stage. If a later agent breaks something, they can revert to the state after any earlier agent completed. Hooks are non-fatal (wrapped in try/catch) so version failures never break the pipeline.

Controlled by `STAGE_HOOKS_ENABLED` config flag (default: `true`).

### 4. Agent `save_version` Tool

Development agents (frontend-dev, backend-dev, styling) have access to a `save_version` tool for explicit checkpoints during code generation. Rate-limited to `MAX_AGENT_VERSIONS_PER_RUN` (3) calls per pipeline run to prevent commit spam. Available via the existing Settings > Tools UI.

### 5. Commit Prefixes

Commits use prefixes to distinguish origin:
- `auto:` — System-generated (stage hooks, pipeline completion)
- `user:` — Manual saves from the UI

The version history UI uses these prefixes to badge user commits differently.

### 6. Lazy Initialization

Git repos are initialized lazily — `ensureGitRepo()` is called on project creation and before any version operation. Existing projects without `.git` are initialized on first version access.

## Alternatives Considered

- **Keep SQLite snapshots, add git later** — Defers the migration cost but doubles the work. Every snapshot feature would need rebuilding for git.
- **Use libgit2/isomorphic-git** — Avoids the `git` CLI dependency but adds a large native module. `Bun.spawnSync` with the git CLI is simpler and already available in Docker.
- **Store diffs instead of full manifests** — Reduces storage but requires applying diffs in sequence for rollback. Git does this automatically with better compression.
- **Use a separate git hosting service** — Adds external dependency. Local git repos are self-contained and work offline.

## Consequences

- **Positive:**
  - Diffs are free — `git diff` provides line-level unified diffs between any two versions
  - GitHub push is trivial — just `git remote add && git push`
  - Storage is efficient — git's packfiles compress far better than full JSON manifests
  - Stage hooks give fine-grained rollback points automatically
  - Existing Settings > Tools UI works for `save_version` configuration

- **Negative:**
  - Requires `git` to be installed (added to Dockerfile; graceful fallback if missing)
  - Each project directory gains a `.git` folder (~40KB base)
  - `git add -A` stages everything — relies on `.gitignore` to exclude secrets and `node_modules`

- **Migration:**
  - `snapshots` table is dropped via `DROP TABLE IF EXISTS` in migrations
  - Old snapshot files deleted: `snapshot.ts`, `snapshots.ts` (routes), `SnapshotList.tsx`, `SnapshotDiff.tsx`
  - Existing projects without `.git` are lazily initialized on first version operation
