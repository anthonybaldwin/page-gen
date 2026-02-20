# Agent Instructions (Shared)

This file is the primary instruction source for all coding agents in this repo.

## Branching Policy (Early Stage)

- You may push directly to `main`.
- No feature branches required for now.
- Keep commit history clean and intentional.
- Before pushing, squash obvious noise commits.

## Commit Frequency

Commit after every meaningful change:

- New feature
- Bug fix
- Refactor
- Schema change
- Dependency change
- Configuration change
- Snapshot/version logic change
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
- Snapshot format changes
- Schema migrations
- Major feature additions

## High-Risk Change Rules

If modifying:

1. Orchestrator logic
2. Token accounting
3. Billing aggregation
4. Snapshot/rollback logic
5. Provider integrations
6. API key handling

You must:

- Commit separately.
- Add tests where applicable.
- Include commit body with risk + validation.

## Snapshot Safety

Any snapshot/version change must:

- Preserve rollback behavior
- Maintain max snapshot pruning
- Include test coverage
- Document migration impact if format changes

## Token Accounting Integrity

Provider-call changes must preserve tracking for:

- Agent
- Provider
- API key
- Per-session usage
- Lifetime totals
- Per-request breakdown

## Architecture Documentation

Non-trivial decisions must:

- Be documented in `docs/adr`
- Be referenced in commit message
- Explain tradeoffs/alternatives

## Test Gate

Before push:

1. Build/typecheck must pass for changed areas.
2. Run tests.
3. No failing snapshots.
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
- Snapshot create/rollback/pruning
- Provider adapters
- API key gating

## Zero-Regression Rule

If touching orchestrator, billing/tokens, snapshots, providers, or security-sensitive code:

- Run full suite where feasible.
- Add targeted tests.
- Mention test status in commit body.

## Wiki Sync Rule

Any new feature/system must update `docs/wiki/` in same commit.

When `docs/wiki/` changes, sync the GitHub wiki clone immediately after commit.

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
