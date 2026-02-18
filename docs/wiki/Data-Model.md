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
| metadata | TEXT | JSON metadata (nullable) |
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
| cost_estimate | REAL | Estimated cost in USD |
| created_at | INTEGER | Unix timestamp (ms) |

### snapshots
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | nanoid |
| project_id | TEXT FK | References projects.id |
| chat_id | TEXT | Associated chat (nullable) |
| label | TEXT | Snapshot label |
| file_manifest | TEXT | JSON: { path: content } |
| created_at | INTEGER | Unix timestamp (ms) |

## Notes

- API keys are **NOT** stored in the database. They live in browser localStorage and are sent per-request via headers.
- All IDs use nanoid (URL-safe, compact).
- Timestamps are Unix milliseconds (not seconds).
- JSON fields (metadata, input, output, file_manifest) are stored as TEXT and parsed by the application.
