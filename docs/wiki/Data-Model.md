# Data Model

All data is stored in a local SQLite database (`data/app.db`) via Drizzle ORM.

## Tables

### projects
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| name | TEXT | Project name |
| path | TEXT | Path to project directory (e.g., ./projects/{id}) |
| created_at | INTEGER | Unix timestamp (ms) |
| updated_at | INTEGER | Unix timestamp (ms) |

### chats
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| project_id | TEXT FK | References projects.id |
| title | TEXT | Chat title |
| created_at | INTEGER | Unix timestamp (ms) |
| updated_at | INTEGER | Unix timestamp (ms) |

### messages
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| chat_id | TEXT FK | References chats.id |
| role | TEXT | 'user', 'assistant', or 'system' |
| content | TEXT | Message content |
| agent_name | TEXT | Which agent produced this (nullable) |
| metadata | TEXT | JSON metadata (nullable). For agent outputs: `{ "type": "agent_output" }` |
| created_at | INTEGER | Unix timestamp (ms) |

### agent_executions
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| chat_id | TEXT FK | References chats.id |
| agent_name | TEXT | Agent identifier |
| status | TEXT | pending, running, completed, failed, retrying |
| input | TEXT | JSON input to the agent |
| output | TEXT | JSON output (nullable) |
| error | TEXT | Error message (nullable) |
| retry_count | INTEGER | Number of retries |
| started_at | INTEGER | Unix timestamp (ms) |
| completed_at | INTEGER | Unix timestamp (nullable) |

### token_usage
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| execution_id | TEXT FK | References agent_executions.id |
| chat_id | TEXT FK | References chats.id |
| agent_name | TEXT | Agent name |
| provider | TEXT | anthropic, openai, google |
| model | TEXT | Exact model ID |
| api_key_hash | TEXT | SHA-256 hash of the API key |
| input_tokens | INTEGER | Input token count |
| output_tokens | INTEGER | Output token count |
| total_tokens | INTEGER | Total tokens |
| cache_creation_input_tokens | INTEGER | Cache creation tokens (default 0) |
| cache_read_input_tokens | INTEGER | Cache read tokens (default 0) |
| cost_estimate | REAL | Estimated cost in USD |
| estimated | INTEGER | 0 = finalized, 1 = provisional (write-ahead tracking) |
| created_at | INTEGER | Unix timestamp (ms) |

### billing_ledger
Permanent, append-only table with **no foreign keys**. Records survive chat/project deletion.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| project_id | TEXT | Denormalized project ID (nullable) |
| project_name | TEXT | Snapshot of project name at record time (nullable) |
| chat_id | TEXT | Denormalized chat ID (nullable) |
| chat_title | TEXT | Snapshot of chat title at record time (nullable) |
| execution_id | TEXT | Associated execution ID (nullable) |
| agent_name | TEXT | Agent name |
| provider | TEXT | anthropic, openai, google |
| model | TEXT | Exact model ID |
| api_key_hash | TEXT | SHA-256 hash of the API key |
| input_tokens | INTEGER | Input token count |
| output_tokens | INTEGER | Output token count |
| total_tokens | INTEGER | Total tokens |
| cache_creation_input_tokens | INTEGER | Cache creation tokens (default 0) |
| cache_read_input_tokens | INTEGER | Cache read tokens (default 0) |
| cost_estimate | REAL | Estimated cost in USD |
| estimated | INTEGER | 0 = finalized, 1 = provisional (write-ahead tracking) |
| created_at | INTEGER | Unix timestamp (ms) |

### pipeline_runs
Tracks each orchestration pipeline execution for resume and debugging.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| chat_id | TEXT FK | References chats.id |
| intent | TEXT | 'build', 'fix', or 'question' |
| scope | TEXT | 'frontend', 'backend', 'styling', or 'full' |
| user_message | TEXT | The user message that triggered this run |
| planned_agents | TEXT | JSON array of agent names in execution order |
| status | TEXT | 'running', 'completed', 'failed', or 'interrupted' |
| started_at | INTEGER | Unix timestamp (ms) |
| completed_at | INTEGER | Unix timestamp (ms, nullable) |

### app_settings
Key-value store for persistent application configuration (e.g., cost limits).

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT PK | Setting name (e.g., maxTokensPerChat) |
| value | TEXT | Setting value (stored as string, parsed as number) |

Default keys seeded on first read:
| Key | Default | Description |
|-----|---------|-------------|
| maxTokensPerChat | 500000 | Token ceiling per chat session |
| maxAgentCallsPerRun | 30 | Max agent invocations per pipeline run |
| maxCostPerDay | 0 | Daily $ cap (0 = unlimited) |
| maxCostPerProject | 0 | Per-project $ cap (0 = unlimited) |

## Notes

**Versioning** — Project versioning is git-based (not stored in SQLite). See [Versioning](Versioning) wiki page. Git settings are stored in `app_settings` with keys `git.user.name` and `git.user.email`.

- API keys are **NOT** stored in the database. They live in browser localStorage and are sent per-request via headers.
- All IDs use nanoid (URL-safe, compact).
- Timestamps are Unix milliseconds (not seconds).
- JSON fields (metadata, input, output, file_manifest) are stored as TEXT and parsed by the application.
- `billing_ledger` is a dual-write from `token_usage`. Every token usage insert writes to both tables. `token_usage` is operational (deleted with chats); `billing_ledger` is permanent.
