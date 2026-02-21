# Agent Instructions (Shared)

This file is the primary instruction source for all coding agents in this repo.

## Branching Policy (Early Stage)

- You may push directly to `main`.
- No feature branches required for now.
- Keep commit history clean and intentional.
- Before pushing, squash obvious noise commits.

## Git Staging (Mandatory)

Always stage files explicitly by name. Never use `git commit -am`, `git add -A`, or `git add .`. Only stage the files you actually modified for the current task.

## Commit Frequency

Commit after every meaningful change:

- New feature
- Bug fix
- Refactor
- Schema change
- Dependency change
- Configuration change
- Versioning logic change
- Token accounting change
- Orchestrator logic change

Avoid massive “everything changed” commits. Split large work into logical commits.

## Commit Message Format (Required)

Use Conventional Commits:

`<type>(<scope>): <short summary>`

Allowed types:

- feat
- fix
- refactor
- chore
- docs
- test
- perf
- security

Rules:

- Use imperative tense.
- Keep subject line under ~72 characters.
- Use scope when meaningful.
- Add a body for WHY/risk/validation when needed.
- Reference ADRs when relevant.
## Squashing Rules

Squash before pushing:

- Debug-only commits
- Console log cleanup commits
- Typo fixes
- Minor formatting-only noise

Do not squash:

- Architectural milestones
- Versioning changes
- Schema migrations
- Major feature additions

## Architecture Overview

Read the full ADRs in `docs/adr/` before modifying any of these systems.

### Agent Pipeline (ADR-002)

13 agent configs (9 base + 4 orchestrator subtasks) in `src/server/agents/registry.ts`. The orchestrator (`src/server/agents/orchestrator.ts`) classifies each user message as `build`, `fix`, or `question` via a cheap Haiku call, then routes to the appropriate pipeline.

**Build:** Research → Architect → Frontend Dev → Backend Dev (conditional) → Styling → Code Review + QA + Security (parallel) → Remediation (max 2 cycles) → Summary.

**Fix:** Dev agent(s) by scope → Reviewers (parallel) → Remediation → Summary. (`finishPipeline` runs vitest directly.)

**Question:** Single Sonnet call with project context, no pipeline.

Pipeline execution uses dependency-aware batch scheduling (`executePipelineSteps`). Steps whose `dependsOn` are all completed run concurrently. Halts on first failure.

### Token Accounting & Cost Safety (ADR-003)

**Dual-write billing.** Every LLM call writes to two tables: `token_usage` (operational, has FKs, deleted with chats) and `billing_ledger` (permanent, no FKs, survives deletion). Both live in `src/server/services/token-tracker.ts`. Never write to one without the other.

**Write-ahead tracking.** Before each LLM call, `trackProvisionalUsage()` inserts records with `estimated=1`. After success, `finalizeTokenUsage()` updates them to `estimated=0`. On failure, `voidProvisionalUsage()` deletes them. This ensures billing data survives server crashes.

**Layered cost limiter.** Four independent checkpoints across `src/server/services/cost-limiter.ts` and the orchestrator:
1. Pre-flight: skip agent if estimated tokens > 95% of session limit
2. Post-batch: hard stop if session token total exceeds limit
3. Daily: hard stop if billing_ledger sum today exceeds daily cap
4. Per-project: hard stop if billing_ledger sum for project exceeds cap

**Upstream output filtering.** `filterUpstreamOutputs()` in the orchestrator routes only relevant upstream data to each agent. This reduces prompt tokens by ~80%. If you add a new agent, you must add a filtering rule for it.

### Client-Side Security (ADR-004)

**API keys never touch the server database.** They are encrypted client-side (AES-GCM 256-bit, Web Crypto API); ciphertext in `localStorage`, encryption key in IndexedDB. Sent per-request via `X-Api-Key-{Provider}` headers. Server only stores SHA-256 hashes in billing records.

Key files: `src/client/lib/crypto.ts`, `src/client/lib/api.ts`.

**Preview sandboxing.** Generated code runs in an iframe with `sandbox="allow-scripts allow-same-origin allow-forms"` — no access to parent app state.

### Preview & Isolation (ADR-005)

**Per-project Vite dev servers.** Each project gets its own Vite on ports 3001–3020. Managed by `src/server/preview/vite-server.ts`. Auto-scaffolds `package.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/index.css`, `tsconfig.json`, and `vitest.config.ts` before starting. Per-project mutex prevents concurrent `bun install`.

**Pipeline-aware preview gating.** `files_changed` events are ignored while the pipeline is running (agents are mid-write). `preview_ready` events always trigger a reload and are only sent after a successful build check.

**Hybrid file extraction.** Primary path: AI SDK native `write_file` tool (files hit disk mid-stream). Fallback: regex-based extraction from agent text output if native tools fail. Tracked via `alreadyWritten` set to avoid duplicates.

**Docker (optional).** Source bind-mounted read-only (`.:/app:ro`). Projects, data, and logs get separate writable volumes. `PREVIEW_HOST=0.0.0.0` for container networking.

### Native Package Blocklist

Packages that require native compilation (`node-gyp`) are blocked from agent-generated projects. The blocklist lives in `src/server/config/packages.ts`. When an agent writes a `package.json` containing a blocked package, the `write_file`/`write_files` tool returns an error with the suggested alternative so the agent self-corrects. The fallback extraction path (`extractAndWriteFiles`) silently strips blocked packages.

To add a new blocked package, edit `BLOCKED_PACKAGES` in `src/server/config/packages.ts` — add the npm package name as key and a short message with the recommended alternative as value. Install failures from any cause are also surfaced to the build-fix agent via `checkProjectBuild`.

## High-Risk Change Rules

If modifying any of the systems above:

1. Orchestrator logic (`src/server/agents/orchestrator.ts`)
2. Token accounting (`src/server/services/token-tracker.ts`, `cost-limiter.ts`)
3. Billing tables (`src/server/db/schema.ts` — `token_usage`, `billing_ledger`)
4. Preview server (`src/server/preview/vite-server.ts`)
5. API key handling (`src/client/lib/crypto.ts`)
6. Upstream output filtering (`filterUpstreamOutputs`)

You must:

- Read the relevant ADR first (`docs/adr/`).
- Commit separately.
- Add tests where applicable.
- Include commit body with risk + validation.
- Update `docs/wiki/` if user-facing behavior changes.

## Version Safety (ADR-006)

Any versioning change must:

- Preserve rollback behavior (git-based: `git checkout <sha> -- .`)
- Maintain display caps (`MAX_AUTO_VERSIONS_DISPLAY`, `MAX_USER_VERSIONS_DISPLAY`)
- Maintain `save_version` rate limiting (`MAX_AGENT_VERSIONS_PER_RUN`)
- Include test coverage
- Keep security hardening intact (path sandboxing, config isolation, input sanitization)

## Token Accounting Integrity

The dual-write pattern is non-negotiable. Any change to token tracking must:

- Write to both `token_usage` and `billing_ledger` (or use `trackBillingOnly` for system calls)
- Preserve the provisional → finalize → void lifecycle
- Maintain cache token columns (`cacheCreationInputTokens`, `cacheReadInputTokens`)
- Keep cost limiter checkpoints intact (pre-flight, post-batch, daily, per-project)
- Not break the upstream output filtering for any agent

## Architecture Documentation

New ADRs are needed when you introduce a **new system-level pattern** — a new table, a new service, a new isolation boundary, a new cost/safety mechanism. If you're adding a feature within an existing pattern (new agent, new endpoint, new UI component), just update the relevant wiki page.

When an ADR is warranted:

- Document in `docs/adr/NNN-short-name.md`
- Reference in commit message
- Explain context, decision, alternatives, and consequences

Current ADRs:
- **001** — Tech stack (Bun, Hono, React, Drizzle, AI SDK)
- **002** — Agent architecture (pipeline, registry, batching)
- **003** — Token accounting & cost safety (dual-write, write-ahead, cost limiter, filtering)
- **004** — Client-side security (encrypted keys, sandboxing)
- **005** — Preview isolation & Docker (per-project Vite, hybrid extraction, containerization)
- **006** — Git-based versioning (replaced SQLite snapshots with git, stage hooks, save_version tool)

## Test Gate

Before push:

1. Build/typecheck must pass for changed areas.
2. Run tests.
3. No failing tests.
4. No skipped critical tests.
5. No temporary debug flags.

If tests fail, fix or revert; do not push broken main.

## Test-With-Every-Commit Rule

For logic-changing commits (`feat`, `fix`, `refactor`):

1. Assess what behavior changed.
2. Add/update tests in same commit.
3. Export non-trivial pure helpers only when needed for tests.
4. Cover edge cases and branching logic.
5. Verify with tests before commit.

If tests are skipped, justify in commit body.

## Required Coverage Focus Areas

- Orchestrator execution flow
- Error halting behavior
- Retry logic
- Resume behavior
- Token usage tracking
- Billing aggregation
- Version create/rollback/listing
- Provider adapters
- API key gating

## Zero-Regression Rule

If touching orchestrator, billing/tokens, versioning, providers, or security-sensitive code:

- Run full suite where feasible.
- Add targeted tests.
- Mention test status in commit body.

## Wiki Sync Rule

Any new feature/system must update `docs/wiki/` in same commit.

Wiki syncing to GitHub Wiki is handled automatically by the `sync-wiki` GitHub Action whenever `docs/wiki/**` changes on `main`. No manual sync is needed.

When adding a new wiki page, also add a link to it in both `README.md` (Documentation section) and `docs/wiki/Home.md` (Quick Links section).

## Principles

- Move fast.
- Commit often.
- Keep history intentional.
- Keep main stable.
- Never silently break orchestration, billing visibility, or rollback.

---

## Codex-Specific Instructions

This section applies only to OpenAI Codex agents.

### Co-Author Trailer

Every Codex-authored commit must include this trailer as the last line:

`Co-authored-by: Codex <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>`

### Commit Message Formatting

Commit message bodies must use real newlines, not escaped characters. Do NOT write literal `\n` sequences in commit messages. Git expects actual line breaks.

Bad (literal escape sequences in body):
```
fix(chat): make timeline sticky\n\nWhy:\n- Reason one.\n- Reason two.
```

Good (real newlines in body):
```
fix(chat): make timeline sticky

Why:
- Reason one.
- Reason two.
```

When constructing commit messages programmatically, ensure newlines are actual newline characters (LF), not the two-character sequence `\n`.
