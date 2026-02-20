# ADR-002: Agent Architecture

## Status
Accepted

## Date
2026-02-18

## Context
Need a multi-agent system where specialized AI agents collaborate to build web pages. Key requirements:
- Sequential pipeline with error halting
- Per-agent model assignment (different models for different tasks)
- Token tracking per request
- Retry logic with configurable max retries
- Resume from interrupted state

## Decision

### Architecture
- **Base agent function** (`runAgent`) wraps AI SDK 6 `generateText` calls
- **Agent registry** defines each agent's name, provider, model, and description
- **Orchestrator** creates a sequential execution plan and dispatches agents
- **Token tracker** records every API call with agent, provider, model, key hash
- **Cost limiter** checks token usage between steps

### Agent Pipeline
```
User Message → Orchestrator → Research → Architect → Frontend Dev → Styling → QA → Security
```

### Error Handling
- Agent failure immediately halts the pipeline
- Up to 3 automatic retries before halting
- Each execution is recorded in `agent_executions` table
- Failed state is surfaced to user via WebSocket

### Model Assignment
| Agent | Model | Provider |
|-------|-------|----------|
| Orchestrator | claude-sonnet-4-6 | Anthropic |
| Research | claude-sonnet-4-6 | Anthropic |
| Architect | claude-sonnet-4-6 | Anthropic |
| Frontend Dev | claude-sonnet-4-6 | Anthropic |
| Backend Dev | claude-sonnet-4-6 | Anthropic |
| Styling | claude-sonnet-4-6 | Anthropic |
| QA | claude-sonnet-4-6 | Anthropic |
| Security | claude-haiku-4-5-20251001 | Anthropic |

## Alternatives Considered
- **Parallel agent execution:** More complex, risk of merge conflicts in file writes
- **Single monolithic agent:** Less specialized, harder to debug/iterate
- **LangChain:** Heavier abstraction, less control than AI SDK 6

## Consequences
- Sequential execution is simpler but slower
- Each agent can be tested/iterated independently
- Token tracking gives full visibility into costs
- Error halting prevents cascading failures
