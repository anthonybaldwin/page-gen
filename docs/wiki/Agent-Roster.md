# Agent Roster

## Overview

The system uses 8 specialized AI agents, coordinated by an orchestrator. Each agent has a specific role, model, and set of tools.

## Agents

### 1. Orchestrator
- **Model:** Claude Opus 4.6 (Anthropic)
- **Role:** Creates execution plan, dispatches agents, synthesizes a single summary, handles errors/retries
- **Tools:** Agent dispatch, snapshot creation
- **Key behaviors:** Halts on error, supports retry, resumes from existing state
- **Output:** After all agents complete, the orchestrator generates a clean markdown summary of what was built. This is the only message the user sees — individual agent outputs are collected internally and never shown directly in chat.

### 2. Research Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Analyzes user request, identifies requirements
- **Output:** Structured requirements document
- **Tools:** None — receives user prompt only, outputs requirements

### 3. Architect Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
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

### 6. Styling Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Applies design polish, responsive layout, theming
- **Tools:** `write_file` only

### 7. QA Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Reviews code, writes tests, checks for issues
- **Tools:** `write_file` only — fixes bugs by writing corrected files

### 8. Security Reviewer
- **Model:** Claude Haiku 4.5 (Anthropic)
- **Role:** Scans for XSS, injection, key exposure
- **Output:** Security report (pass/fail with findings)
- **Tools:** None — reviews code from previous agent outputs

## Pipeline

```
User → Orchestrator → Research → Architect → Frontend Dev → [Build Check] → Styling → QA → Security
  → Remediation Loop (max 2 cycles):
      ├─ detectIssues(QA + Security output)
      ├─ if clean → break
      ├─ Frontend Dev fixes findings
      ├─ extract/write corrected files
      ├─ re-run QA on updated code
      ├─ re-run Security on updated code
      └─ loop back to detectIssues()
  → [Final Build Check] → Summary
```

- Each agent's output is collected internally by the orchestrator (not saved as a chat message).
- Agent execution records are still saved to the `agentExecutions` table for debugging and the status panel.
- After the pipeline completes, the orchestrator calls its own model to generate a single markdown summary.
- Only this summary is saved as a chat message and shown to the user.
- The pipeline halts immediately on any agent failure. Up to 3 retries are attempted before halting.

### Remediation Loop

After the initial QA and Security agents run, the orchestrator checks their output for issues using `detectIssues()`. If issues are found:

1. **Frontend Dev** receives the QA/security findings and outputs corrected files
2. **QA Agent** re-reviews the updated code (display name shows "re-review #N")
3. **Security Reviewer** re-scans the updated code
4. If issues persist, the loop repeats (max 2 cycles)

Each cycle checks the cost limit before proceeding. The loop exits early if:
- All issues are resolved (QA passes + Security passes)
- Cost limit is reached
- The pipeline is aborted by the user
- A remediation or re-review agent fails

In the UI, re-review agents show their cycle number (e.g., "QA Agent (re-review #1)") so the user can track the iteration.

### File Extraction

Agents don't write files directly to disk. Instead:
1. Agents include `<tool_call>` blocks with `write_file` in their text output
2. The orchestrator's `extractAndWriteFiles()` parses these tool calls from the output
3. Files are written to the project directory via `file-ops.ts`
4. A `files_changed` WebSocket event is broadcast so the UI updates

### Build Check Pipeline

After each file-producing agent (frontend-dev, styling, QA), the orchestrator:
1. Runs `bunx vite build --mode development` to check for compile errors
2. If errors are found, feeds them back to the frontend-dev agent for auto-fixing
3. Only broadcasts `preview_ready` after a successful build
4. The Preview tab stays disabled until the build passes

## Token Tracking

Every API call records:
- Agent name
- Provider
- Model ID
- API key hash (SHA-256)
- Input/output tokens
- Cost estimate (USD)

## Cost Safety

- Default limit: 500K tokens per session
- Warning at 80% usage
- Pause at 100% — user must confirm to continue
