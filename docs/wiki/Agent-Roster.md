# Agent Roster

## Overview

The system uses 8 specialized AI agents, coordinated by an orchestrator. Each agent has a specific role, model, and set of tools.

## Agents

### 1. Orchestrator
- **Model:** Claude Opus 4.6 (Anthropic)
- **Role:** Creates execution plan, dispatches agents, merges results, handles errors/retries
- **Tools:** Agent dispatch, snapshot creation
- **Key behaviors:** Halts on error, supports retry, resumes from existing state

### 2. Research Agent
- **Model:** Gemini 2.5 Flash (Google)
- **Role:** Analyzes user request, identifies requirements
- **Output:** Structured requirements document
- **Tools:** Project file read

### 3. Architect Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Designs component tree, file structure, data flow
- **Output:** Component hierarchy, file plan, dependency list
- **Tools:** File read/list

### 4. Frontend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates React/HTML/CSS/JS code
- **Tools:** File read/write, search, shell (npm install)

### 5. Backend Developer
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Generates API routes, server logic
- **Tools:** File read/write, shell

### 6. Styling Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Applies design polish, responsive layout, theming
- **Tools:** File read/write

### 7. QA Agent
- **Model:** Claude Sonnet 4.6 (Anthropic)
- **Role:** Reviews code, writes tests, checks for issues
- **Tools:** File read, search, shell

### 8. Security Reviewer
- **Model:** Claude Haiku 4.5 (Anthropic)
- **Role:** Scans for XSS, injection, key exposure
- **Output:** Security report
- **Tools:** File read, search

## Pipeline

```
User → Orchestrator → Research → Architect → Frontend Dev → Styling → QA → Security
```

The pipeline halts immediately on any agent failure. Up to 3 retries are attempted before halting.

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
