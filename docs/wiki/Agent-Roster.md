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
- **Role:** Designs component tree, file structure, data flow, and test plan
- **Output:** Component hierarchy, file plan, dependency list, and `test_plan` section (build mode only)
- **Tools:** None — receives research output, produces architecture doc with embedded test specs

### 4. Frontend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates React/HTML/CSS/JS code and writes test files alongside components
- **Tools:** `write_file`, `read_file`, `list_files` — native AI SDK tools executed mid-stream
- **Test responsibility:** Writes vitest test files alongside components, following the test plan from the architect (build mode) or test planner (fix mode)

### 5. Backend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates API routes, server logic, and writes test files alongside server code
- **Tools:** `write_file`, `read_file`, `list_files` — native AI SDK tools executed mid-stream
- **Test responsibility:** Writes vitest test files alongside server modules, following the test plan
- **Note:** Only runs when the research agent identifies features requiring a backend (`requires_backend: true`)

### 6. Styling Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Applies design polish, responsive layout, theming
- **Tools:** `write_file`, `read_file`, `list_files` — native AI SDK tools executed mid-stream

### 7. Test Planner (fix mode only)
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Creates a JSON test plan that defines expected behavior — dev agents use this to write test files alongside their code
- **Tools:** `read_file`, `list_files` — read-only access for inspecting existing code
- **Output:** Structured JSON test plan with component-to-test mapping, behavior descriptions, and setup notes
- **Position (build mode):** Not used as a separate step — the architect includes a `test_plan` section in its output, saving one API call and one pipeline stage
- **Position (fix mode):** First step — creates test plan that defines expected behavior for the fix (no architect in fix mode, so test planner runs independently)
- **Post-step:** After each dev agent writes files, the orchestrator runs `bunx vitest run` with verbose+json reporters. If tests fail, routes failures to the dev agent for one fix attempt, then re-runs tests.
- **Test results:** Broadcast via `test_results` and `test_result_incremental` WebSocket events. Displayed **inline** as thinking blocks at the point in the pipeline where tests ran, with a per-test checklist UI and streaming results.

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

### Build Pipeline (Parallelized)

```
User → Orchestrator → classifyIntent() → "build" (scope used for backend gating)
  → Phase 1: Research (determines requirements + backend needs)
  → Phase 2: Dynamic plan from research output
      → Architect (architecture + test plan)
      → Frontend Dev → [write tests + code] → [run tests]
      → Backend Dev → [write tests + code] → [run tests]  (only if scope + research require it)
      → Styling (waits for all dev agents)
      → Code Review ─┐
      → Security     ├─ (parallel, all depend on Styling)
      → QA           ─┘
  → Remediation Loop (max 2 cycles, re-reviews run in parallel)
  → [Final Build Check] → Summary
```

**Stage count:** 5 stages without backend, 6 with backend.

### Fix Pipeline (Parallelized)

```
User → Orchestrator → classifyIntent() → "fix" (scope: frontend|backend|styling|full)
  → Read existing project source
  → Test Planner (create test plan for the fix)
  → Route to dev agent(s) by scope:
      frontend → frontend-dev → [write tests + code] → [run tests]
      backend  → backend-dev → [write tests + code] → [run tests]
      styling  → styling → [run tests]
      full     → frontend-dev + backend-dev → [write tests + code] → [run tests]
  → Code Review ─┐
  → Security     ├─ (parallel, all depend on last dev agent)
  → QA           ─┘
  → Remediation Loop (max 2 cycles, re-reviews run in parallel)
  → [Final Build Check] → Summary
```

### Question Mode

```
User → Orchestrator → classifyIntent() → "question"
  → Read project source for context
  → Single Opus call → Direct answer (no agents, no pipeline bar)
```

### Parallelization Details

The pipeline executor uses dependency-aware batch scheduling:
- Steps whose `dependsOn` are all in the completed set run concurrently as a batch
- When a batch completes, newly unblocked steps form the next batch
- Halts on first failure within any batch
- Cost limit checked after each batch completes

**Parallel groups in build mode:**
- `frontend-dev` depends on `architect`; `backend-dev` depends on `frontend-dev` (sequential to avoid file conflicts)
- `styling` depends on all dev agents → waits for both to complete
- `code-review`, `security`, and `qa` all depend on `styling` → run in parallel

**Remediation re-reviews** also run in parallel (`Promise.all` for code-review, security, qa).

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

Backend-dev inclusion is gated by two checks:

1. **Scope gate:** If the intent classifier sets scope to `frontend` or `styling`, backend-dev is skipped regardless of research output. This prevents false positives like "no backend needed" triggering the backend agent.
2. **Research gate:** The research agent outputs `requires_backend: true/false` per feature in its JSON requirements. The orchestrator's `needsBackend()` function checks this flag (with a regex heuristic fallback) to decide whether to include backend-dev.

Both must agree — scope must allow it AND research must indicate it.

### Remediation Loop

After the initial code-review, security, and QA agents run, the orchestrator checks their output for issues using `detectIssues()`. If issues are found:

1. **Route findings** to the correct dev agent(s) based on `[frontend]`/`[backend]`/`[styling]` tags from code-review and QA output. Defaults to frontend-dev when no clear routing.
2. **Dev agent(s)** receive the findings and output corrected files
3. **Re-review agents run in parallel:** Code Reviewer, Security Reviewer, and QA Agent all re-evaluate simultaneously
4. If issues persist, the loop repeats (max 2 cycles)

Each cycle checks the cost limit before proceeding. The loop exits early if:
- All issues are resolved (code-review passes + security passes + QA passes)
- Issues are not improving between cycles (prevents ping-pong loops)
- Total agent call limit reached (MAX_TOTAL_AGENT_CALLS = 30)
- Cost limit is reached
- The pipeline is aborted by the user
- A remediation or re-review agent fails

**Key design principle:** Only dev agents (frontend-dev, backend-dev, styling) write code. All review agents (code-review, security, qa) are read-only reporters. This prevents two agents from fighting over the same files.

In the UI, re-review agents show their cycle number (e.g., "Code Reviewer (re-review #1)") so the user can track the iteration.

### Thinking Block History

When remediation routes back to an agent that already ran (e.g., frontend-dev runs again to fix review findings), the UI **appends a new thinking block** instead of replacing the original. This preserves the full history so users can see both the original output and the remediation output.

Blocks are identified by unique IDs. The `toggleExpanded` action targets blocks by ID, not agent name, so expanding one "Frontend Developer" block doesn't affect others.

### Inline Test Results

Test results appear **inline in the thinking block timeline** at the point where tests ran, rather than as a separate banner at the bottom. This makes it clear which dev agent's output triggered the test run. The `TestResultsBanner` component is rendered inside `AgentThinkingMessage` when a block has `blockType: "test-results"`.

### Native Tool Use

Agents use the Vercel AI SDK's native `tool()` definitions instead of text-based `<tool_call>` XML. This enables:

- **Mid-stream file writes:** `write_file` executes during generation — files hit disk immediately, Vite HMR picks up changes
- **File reading:** `read_file` lets agents inspect existing code (especially useful in fix mode)
- **Project exploration:** `list_files` lets agents discover the project structure
- **Clean thinking blocks:** Agent reasoning text contains only thoughts, not code dumps
- **Cross-provider compatibility:** Works identically across Anthropic, OpenAI, and Gemini via AI SDK abstraction

**Fallback extraction:** If an agent outputs `<tool_call>` XML in its text instead of using native tools, `extractAndWriteFiles()` still parses and writes those files. Files already written natively are skipped (tracked via `alreadyWritten` set). A warning is logged when fallback extraction is triggered.

**Tool-use loop limit:** `stopWhen: stepCountIs(15)` prevents runaway tool-use loops.

### File Extraction (Hardened, Fallback)

The fallback extraction pipeline handles agents that don't use native tools:
1. Agents include `<tool_call>` blocks with `write_file` in their text output
2. The orchestrator's `extractAndWriteFiles()` parses these tool calls from the output
3. **JSON repair step:** When `JSON.parse` fails, the extractor first attempts to repair common issues (literal newlines, tabs, BOM characters) before falling back to regex. Warnings are logged for debugging.
4. **Content normalization:** All extracted content is cleaned (BOM stripped, CRLF→LF, CR→LF)
5. File paths are sanitized (strip leading quotes/backticks, normalize separators)
6. Files are written to the project directory via `file-ops.ts`
7. A `files_changed` WebSocket event is broadcast so the UI updates

### Build Check Pipeline

After each file-producing agent (frontend-dev, backend-dev, styling), the orchestrator:
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

### Tool Assignments

Each agent's native tool access can be configured via **Settings → Tools**. The three available tools are `write_file`, `read_file`, and `list_files`.

**Defaults:**
| Agent | write_file | read_file | list_files |
|-------|-----------|-----------|------------|
| frontend-dev, backend-dev, styling | Yes | Yes | Yes |
| research, architect, testing, code-review, qa, security | No | Yes | Yes |
| orchestrator | No | No | No |

- Tool overrides are stored in `app_settings` (key: `agent.{name}.tools`, value: JSON array)
- The orchestrator reads tool config at runtime via `getAgentTools()` and only passes enabled tools to each agent
- Orchestrator is read-only — it never gets native tools
- `extractAndWriteFiles()` also respects tool config: agents without `write_file` skip fallback file extraction
- Resetting an agent's tools removes the DB override, reverting to the default
- Build checks and test runs only trigger for agents that have `write_file` enabled

## Cost Safety

- Default limit: 500K tokens per session
- Warning at 80% usage
- Pause at 100% — user must confirm to continue
- Hard cap: configurable agent call limit per orchestration (default 30, set in Settings → Limits)
- Remediation improvement check: exits if issues aren't decreasing between cycles

## Streaming Optimization

Agent output is streamed to the client via WebSocket using the AI SDK's `fullStream` API, which provides a unified event stream for text chunks, tool calls, and tool results. Broadcasts are **throttled to ~7 messages/sec** (150ms batching) to reduce noise and client re-renders. Chunks are accumulated and sent in batches. The final remaining chunk is always flushed.
