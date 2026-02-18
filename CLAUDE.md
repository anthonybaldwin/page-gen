# Git & Commit Discipline (Claude Rules)

You are allowed to move fast. We are optimizing for velocity in early development.

## Branching Policy (Early Stage)

- You may push directly to `main`.
- No feature branches required for now.
- However, keep commit history clean and intentional.
- Before pushing, squash obvious noise commits.
- Later we may introduce stricter branching and PR review.

---

## Commit Frequently

You must commit after every meaningful change:

- New feature
- Bug fix
- Refactor
- Schema change
- Dependency change
- Configuration change
- Snapshot/version logic change
- Token accounting change
- Orchestrator logic change

Avoid massive “everything changed” commits.

If work grows large, split it into logical incremental commits.

---

## Commit Message Format (Required)

Use Conventional Commits:

<type>(<scope>): <short summary>

Examples:

- feat(orchestrator): implement execution halt on agent error
- feat(auth): gate app behind API key entry
- fix(tokens): correct per-agent usage aggregation
- refactor(snapshots): simplify rollback pruning logic
- chore(deps): add sqlite driver
- test(backend): add billing integrity tests
- docs(readme): document proxy URL handling
- perf(hmr): improve preview reload latency
- security(keys): isolate localStorage access layer

Rules:

- Use imperative tense (“add”, “fix”, not “added”, “fixed”).
- Keep subject line under ~72 characters.
- Scope is required when meaningful (agent name, subsystem, feature).
- If needed, include a body explaining WHY (not just what).
- Reference ADRs when relevant.

Allowed types:

- feat
- fix
- refactor
- chore
- docs
- test
- perf
- security

---

## Squashing Rules

Squash before pushing:

- Debug-only commits
- Console.log removals
- Typo fixes
- Minor formatting noise

Do NOT squash:

- Architectural milestones
- Snapshot format changes
- Schema migrations
- Major feature additions

Keep history readable and logically grouped.

---

## High-Risk Change Rules

Include a short commit body explaining the risk and validation performed.

If modifying any of the following, you MUST:

1) Orchestrator logic
2) Token accounting
3) Billing aggregation
4) Snapshot/rollback logic
5) Provider integrations
6) API key handling

Then:

- Commit separately.
- Add tests if applicable.
- Confirm execution still halts on errors.
- Confirm token tracking integrity is preserved.

---

## Snapshot Safety Rule

Any change touching snapshot/version logic must:

- Preserve rollback behavior.
- Maintain max snapshot pruning.
- Include test coverage.
- Explicitly state migration impact if format changes.

---

## Token Accounting Integrity Rule

Any change affecting provider calls must verify tracking still records:

- Agent
- Provider
- API key
- Per-session usage
- Lifetime totals
- Per-request breakdown

No silent regression allowed.

---

## Extensibility Check (Before Major Push)

Before merging major features, confirm:

- Does this make GitHub integration harder later?
- Does this couple agents too tightly?
- Is the orchestrator still generic?
- Are provider integrations still abstracted?

If yes, refactor before pushing.

---

## Architectural Decisions

Non-trivial decisions must:

- Be documented in /docs/adr
- Be referenced in the commit message
- Explain tradeoffs and alternatives considered

---

## Test Gate (Mandatory Before Push)

You MUST NOT push to main unless all tests pass.

Before every push:

0) Confirm the project builds successfully.
   - No TypeScript errors.
   - No bundler errors.
   - No runtime startup failures.
1) Confirm the README and CLAUDE.md are up to date.
2) Run the full test suite.
3) Confirm all tests pass.
4) Confirm no failing snapshot tests.
5) Confirm no skipped critical tests.
6) Confirm no temporary debug flags are enabled.

If tests fail:
- Fix the issue.
- Or revert the breaking change.
- Do NOT push broken builds to main.

Before pushing:
- No leftover TODO or FIXME comments unless intentionally tracked.
- No dead code blocks.
- No commented-out logic left behind.

---

## Required Test Coverage Areas

At minimum, tests must cover:

- Orchestrator execution flow
- Error halting behavior
- Retry logic
- Resume-from-existing-chat behavior
- Token usage tracking (per agent, provider, key, session)
- Billing aggregation logic
- Snapshot creation
- Snapshot rollback
- Snapshot pruning (max limit enforcement)
- Provider integration adapters
- API key gating logic

If modifying any of the above systems, you must:
- Add or update tests accordingly.
- Confirm coverage is not reduced.

---

## Zero-Regression Rule

If a commit modifies:
- Orchestrator logic
- Token accounting
- Snapshot/version system
- Provider integrations
- Security-sensitive code

You must:
- Run the full suite.
- Add targeted tests for the change.
- Ensure no regressions.
- Explicitly mention in the commit body that tests passed.

---

If CI is configured:
- CI must pass before main is considered stable.
- Do not bypass failing CI.

---

## Wiki Documentation Rule

Any new feature or system must have a corresponding `docs/wiki/` page updated in the same commit. Documentation lives in `docs/wiki/` and will later sync to the GitHub repo wiki.

---

Principles:

Move fast.
Commit often.
Keep history intentional.
Tests must pass.
Broken main is unacceptable.
Never silently break orchestration, billing visibility, or rollback.
