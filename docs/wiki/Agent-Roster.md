# Agent Roster

## Overview

The system uses 10 specialized AI agents, coordinated by an orchestrator. Each agent has a specific role, model, and set of tools.

## Agents

### 1. Orchestrator
- **Model:** Claude Opus 4.6 (Anthropic)
- **Role:** Creates execution plan, dispatches agents, synthesizes a single summary, handles errors/retries
- **Tools:** Agent dispatch, snapshot creation
- **Key behaviors:** Halts on error, supports retry, resumes from existing state
- **Output:** After all agents complete, the orchestrator generates a clean markdown summary of what was built. This is the only message the user sees — individual agent outputs are collected internally and never shown directly in chat.

### 2. Research Agent
- **Model:** Claude Opus 4.6 (Anthropic)
- **Role:** Analyzes user request, identifies requirements
- **Output:** Structured JSON requirements document (includes `requires_backend` per feature for conditional pipeline)
- **Tools:** None — receives user prompt only, outputs requirements

### 3. Architect Agent
- **Model:** Claude Opus 4.6 (Anthropic)
- **Role:** Designs component tree, file structure, data flow
- **Output:** Component hierarchy, file plan, dependency list
- **Tools:** None — receives research output, produces architecture doc

### 4. Frontend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates React/HTML/CSS/JS code
- **Tools:** `write_file` only — code is extracted from output and written to disk by the orchestrator

### 5. Backend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates API routes, server logic
- **Tools:** `write_file` only
- **Note:** Only runs when the research agent identifies features requiring a backend (`requires_backend: true`)

### 6. Styling Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Applies design polish, responsive layout, theming
- **Tools:** `write_file` only

### 7. Testing Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Writes vitest unit/integration tests for generated React components
- **Tools:** `write_file` only — writes test files and vitest config
- **Output:** Test files using vitest + @testing-library/react + happy-dom
- **Position:** After styling, before code-review (both build and fix modes)
- **Post-step:** Orchestrator runs `bunx vitest run --reporter=json` after test files are written. If tests fail, routes failures to frontend-dev for one fix attempt, then re-runs tests.
- **Test results:** Broadcast via `test_results` WebSocket event and displayed in a TestResultsBanner component

### 8. Code Reviewer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Reviews code for bugs, type errors, and correctness; reports issues for dev agents to fix
- **Tools:** None — read-only, report only
- **Output:** Structured JSON report with `status: "pass" | "fail"`, categorized findings (`[frontend]`, `[backend]`, `[styling]`)

### 9. QA Agent (Requirements Validator)
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Validates implementation against research requirements; reports gaps without fixing code
- **Tools:** None — read-only, report only
- **Output:** Structured JSON report with `status: "pass" | "fail"`, requirements coverage, and categorized issues (`[frontend]`, `[backend]`, `[styling]`)

### 10. Security Reviewer
- **Model:** Claude Haiku 4.5 (Anthropic)
- **Role:** Scans for XSS, injection, key exposure
- **Output:** Security report (pass/fail with findings)
- **Tools:** None — reviews code from previous agent outputs

## Pipeline

### Intent-Based Routing

Before running the pipeline, the orchestrator classifies the user's message into one of three intents:

| Intent | When | Pipeline |
|--------|------|----------|
| **build** | New feature, new project, adding something new | Full pipeline (research → architect → devs → reviewers) |
| **fix** | Changing/fixing something in an existing project | Skip research/architect → route to relevant dev agent(s) → reviewers |
| **question** | Asking about the project or non-code request | Direct Opus answer with project context, no pipeline |

Classification uses a ~50-token Opus call. Fast-path: empty projects always get "build" (no API call needed).

### Build Pipeline (Full)

```
User → Orchestrator → classifyIntent() → "build"
  → Phase 1: Research (determines requirements + backend needs)
  → Phase 2: Dynamic plan from research output
      → Architect → Frontend Dev → [Backend Dev if needed] → [Build Check]
      → Styling → Testing (write + run vitest) → Code Review → Security
      → QA (validate requirements)
  → Remediation Loop (max 2 cycles)
  → [Final Build Check] → Summary
```

### Fix Pipeline (Scoped)

```
User → Orchestrator → classifyIntent() → "fix" (scope: frontend|backend|styling|full)
  → Read existing project source
  → Route to dev agent(s) by scope:
      frontend → frontend-dev
      backend  → backend-dev
      styling  → styling
      full     → frontend-dev + backend-dev
  → Testing → Code Review → Security → QA
  → Remediation Loop (max 2 cycles)
  → [Final Build Check] → Summary
```

### Question Mode

```
User → Orchestrator → classifyIntent() → "question"
  → Read project source for context
  → Single Opus call → Direct answer (no agents, no pipeline bar)
```

### Pipeline Plan Broadcasting

The orchestrator broadcasts a `pipeline_plan` WebSocket message at the start of each pipeline. The client uses this to dynamically render only the relevant agents in the status bar:
- Build mode: shows all agents in the plan
- Fix mode: shows only the dev agent(s) + reviewers
- Question mode: hides the pipeline bar entirely, shows a "Thinking..." indicator

### General Pipeline Behavior

- Each agent's output is collected internally by the orchestrator (not saved as a chat message).
- Agent execution records are still saved to the `agentExecutions` table for debugging and the status panel.
- After the pipeline completes, the orchestrator calls its own model to generate a single markdown summary.
- Only this summary is saved as a chat message and shown to the user.
- The pipeline halts immediately on any agent failure. Up to 3 retries are attempted before halting.
- All WebSocket messages include `chatId` so multiple chats can run simultaneously without cross-talk.

### Conditional Backend

The research agent outputs `requires_backend: true/false` per feature in its JSON requirements. The orchestrator's `needsBackend()` function checks this flag (with a regex heuristic fallback) to decide whether to include backend-dev in the execution plan.

### Remediation Loop

After the initial code-review, security, and QA agents run, the orchestrator checks their output for issues using `detectIssues()`. If issues are found:

1. **Route findings** to the correct dev agent(s) based on `[frontend]`/`[backend]`/`[styling]` tags from code-review and QA output. Defaults to frontend-dev when no clear routing.
2. **Dev agent(s)** receive the findings and output corrected files
3. **Code Reviewer** re-reviews the updated code (display name shows "re-review #N")
4. **Security Reviewer** re-scans the updated code
5. **QA Agent** re-validates against requirements
6. If issues persist, the loop repeats (max 2 cycles)

Each cycle checks the cost limit before proceeding. The loop exits early if:
- All issues are resolved (code-review passes + security passes + QA passes)
- Issues are not improving between cycles (prevents ping-pong loops)
- Total agent call limit reached (MAX_TOTAL_AGENT_CALLS = 30)
- Cost limit is reached
- The pipeline is aborted by the user
- A remediation or re-review agent fails

**Key design principle:** Only dev agents (frontend-dev, backend-dev, styling) write code. All review agents (code-review, security, qa) are read-only reporters. This prevents two agents from fighting over the same files.

In the UI, re-review agents show their cycle number (e.g., "Code Reviewer (re-review #1)") so the user can track the iteration.

### File Extraction

Agents don't write files directly to disk. Instead:
1. Agents include `<tool_call>` blocks with `write_file` in their text output
2. The orchestrator's `extractAndWriteFiles()` parses these tool calls from the output
3. File paths are sanitized (strip leading quotes/backticks, normalize separators)
4. Files are written to the project directory via `file-ops.ts`
5. A `files_changed` WebSocket event is broadcast so the UI updates

### Build Check Pipeline

After each file-producing agent (frontend-dev, backend-dev, styling, testing), the orchestrator:
1. Runs `bunx vite build --mode development` to check for compile errors
2. If errors are found, routes them to the appropriate dev agent (backend-dev for server file errors, frontend-dev otherwise)
3. Only broadcasts `preview_ready` after a successful build
4. The preview pane updates live once the build passes

## Token Tracking

Every API call records:
- Agent name
- Provider
- Model ID
- API key hash (SHA-256)
- Input/output tokens
- Cost estimate (USD)

## Agent Customization

Each agent's provider, model, and system prompt can be overridden via **Settings → Models** and **Settings → Prompts**.

- Overrides are stored in the `app_settings` table (keys: `agent.{name}.provider`, `agent.{name}.model`, `agent.{name}.prompt`)
- The orchestrator reads resolved configs (DB overrides layered on AGENT_ROSTER defaults) at runtime
- Custom prompts replace the default `.md` file prompts completely
- Resetting an agent removes all DB overrides, reverting to AGENT_ROSTER defaults
- Changes take effect on the next pipeline run — no restart required

## Cost Safety

- Default limit: 500K tokens per session
- Warning at 80% usage
- Pause at 100% — user must confirm to continue
- Hard cap: configurable agent call limit per orchestration (default 30, set in Settings → Limits)
- Remediation improvement check: exits if issues aren't decreasing between cycles
