# Pipeline Flow Editor & Custom Tools

## Overview

The Pipeline Flow Editor lets you visually design agent execution pipelines. Instead of the hardcoded build/fix/question flows, you can create custom DAG-based templates with conditional routing, checkpoints, and post-actions.

Custom Tools let you define your own tools (HTTP endpoints, JavaScript functions, shell commands) that agents can use during pipeline runs.

## Flow Editor

### Accessing the Editor

Open **Settings > Pipeline** to access the flow editor.

### Concepts

- **Flow Template**: A named, versioned DAG of nodes and edges for a specific intent (build, fix, question).
- **Intent Binding**: Each intent (build, fix, question) can have one active template. When active, the orchestrator uses it instead of the hardcoded pipeline.
- **Fallback**: If no template is active or resolution fails, the orchestrator falls back to the original hardcoded logic.

### Node Types

| Type | Icon | Purpose |
|------|------|---------|
| Agent | Bot | Run a specific agent with an input template |
| Condition | Branch | Evaluate a condition and route to true/false branches |
| Checkpoint | Pause | Pause for user approval (Phase 2) |
| Post-Action | Gear | Run build checks, tests, or remediation loops (Phase 2) |

### Condition Nodes

Condition nodes support two modes:

1. **Predefined**: Select from known conditions:
   - `needsBackend` — True when the project requires a backend server
   - `scopeIncludes:frontend` — True when scope is 'frontend' or 'full'
   - `scopeIncludes:backend` — True when scope is 'backend' or 'full'
   - `scopeIncludes:styling` — True when scope is 'styling'
   - `hasFiles` — True when the project already has files

2. **Expression**: Write a boolean expression using allowed variables:
   - `intent` — "build", "fix", or "question"
   - `scope` — "frontend", "backend", "styling", or "full"
   - `needsBackend` — boolean
   - `hasFiles` — boolean

Example: `scope === 'backend' || scope === 'full'`

### Input Templates

Agent nodes have an input template field. Use `{{userMessage}}` to interpolate the user's original message.

### Validation

Before saving, the editor validates:
- DAG acyclicity (no cycles)
- All nodes reachable from start nodes
- Agent names exist in the registry
- Condition expressions use only allowed variables
- At least one start and terminal node
- Edge source/target IDs reference existing nodes

### Default Templates

Click "Reset Defaults" to regenerate the three default templates that replicate the hardcoded pipeline behavior.

## Custom Tools

### Accessing Custom Tools

Open **Settings > Tools** and scroll to the "Custom Tools" section.

### Creating a Tool

1. Click **+ Add Tool**
2. Fill in:
   - **Name**: Unique ID (lowercase, hyphens allowed)
   - **Display Name**: Shown in the UI
   - **Description**: Shown to the LLM so it knows when to use the tool
   - **Parameters**: Define input parameters with name, type (string/number/boolean), and description
3. Choose an implementation type:
   - **HTTP**: Call an external API with URL/body/header interpolation
   - **JavaScript**: Run sandboxed JS code (5s timeout)
   - **Shell**: Run a shell command (requires explicit opt-in)
4. Click **Test** to verify with sample parameters
5. Click **Create** to save

### Implementation Types

#### HTTP
- Set method (GET, POST, PUT, DELETE, PATCH) and URL
- Use `{{paramName}}` in URL, headers, and body for parameter interpolation
- Responses are returned as JSON or text
- 30-second timeout

#### JavaScript
- Access parameters via the `params` object
- Return a value from your code
- Restricted scope: only `params`, `JSON`, `Math`, `Date`, basic constructors
- 5-second timeout
- **Warning**: Runs on your machine with server-level access

#### Shell
- Use `{{paramName}}` in the command template for interpolation
- Optionally set working directory and timeout
- **Gated**: Must enable `allowShellTools` in Settings > Limits > Pipeline Settings
- 30-second default timeout

### Enabling Custom Tools for Agents

Custom tools appear in the per-agent toggle grid alongside built-in tools. Enable them for specific agents just like built-in tools.

## API Reference

### Flow Templates

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/settings/flow/templates` | List all templates |
| GET | `/api/settings/flow/templates/:id` | Get template by ID |
| PUT | `/api/settings/flow/templates/:id` | Create/update template |
| DELETE | `/api/settings/flow/templates/:id` | Delete template |
| GET | `/api/settings/flow/active` | Get active bindings |
| PUT | `/api/settings/flow/active` | Set active template for intent |
| POST | `/api/settings/flow/validate` | Validate without saving |
| POST | `/api/settings/flow/defaults` | Regenerate defaults |

### Custom Tools

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/settings/custom-tools` | List all custom tools |
| GET | `/api/settings/custom-tools/:name` | Get tool by name |
| PUT | `/api/settings/custom-tools/:name` | Create/update tool |
| DELETE | `/api/settings/custom-tools/:name` | Delete tool |
| POST | `/api/settings/custom-tools/:name/test` | Test-execute with sample params |

## Architecture

See [ADR-008](../adr/008-flow-editor-custom-tools.md) for the full architecture decision record.

### Storage

Both flow templates and custom tools are stored in the `app_settings` KV table:
- Flow templates: `flow.template.{id}` → JSON
- Active bindings: `flow.active.{intent}` → template ID
- Custom tools: `custom_tool.{name}` → JSON

### Orchestrator Integration

The orchestrator checks for an active flow template before using hardcoded logic:

```
getActiveFlowTemplate(intent)
  → found and enabled? → resolveFlowTemplate(template, context) → ExecutionPlan
  → not found?         → buildExecutionPlan() / buildFixPlan() (hardcoded fallback)
```
