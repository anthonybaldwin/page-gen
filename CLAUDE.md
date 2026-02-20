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
- For Codex-authored commits, include this trailer exactly:
  `Co-authored-by: chatgpt-codex-connector[bot] <199175422+chatgpt-codex-connector[bot]@users.noreply.github.com>`

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

## Test-With-Every-Commit Rule

Every commit that changes logic (feat, fix, refactor) must include test analysis:

1. **Assess testability:** Before committing, identify which pure functions, helpers, or behaviors changed.
2. **Add or update tests:** If the change introduces new logic or modifies existing behavior, include tests in the same commit — not as a follow-up.
3. **Export for testability:** If a function is non-trivial and worth testing, export it. Keep the export minimal (don't expose internal state, just pure functions).
4. **Test what matters:** Focus on pure functions with clear inputs/outputs, edge cases in parsing/routing logic, and conditional branches. Don't test trivial getters or framework boilerplate.
5. **Verify before committing:** Run `bun test` and confirm all tests pass before every commit — not just before pushing.

If you skip tests for a logic-changing commit, you must justify why in the commit body.

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

Any new feature or system must have a corresponding `docs/wiki/` page updated in the same commit.

**Manual wiki sync required:** `docs/wiki/` is the source of truth. The GitHub repo wiki must stay 100% in sync. Whenever you create or update any file in `docs/wiki/`, you MUST also push those changes to the GitHub wiki repo immediately after committing:

```bash
# From repo root — sync docs/wiki/ to the GitHub wiki
cp docs/wiki/*.md /tmp/wiki-sync/ && \
  cd <wiki-repo-clone> && \
  cp /tmp/wiki-sync/*.md . && \
  git add -A && git commit -m "sync wiki from docs/wiki" && git push
```

In practice, use the following steps after every commit that touches `docs/wiki/`:

1. Clone the wiki repo if not already cloned:
   `git clone https://github.com/anthonybaldwin/just-build-it.wiki.git ../just-build-it-wiki`
2. Copy all wiki files:
   `cp docs/wiki/*.md ../just-build-it-wiki/`
3. Commit and push the wiki:
   `cd ../just-build-it-wiki && git add -A && git commit -m "sync: update wiki from docs/wiki" && git push`

This is a temporary manual process. A GitHub Action with a PAT will automate this later.

---

Principles:

Move fast.
Commit often.
Keep history intentional.
Tests must pass.
Broken main is unacceptable.
Never silently break orchestration, billing visibility, or rollback.
