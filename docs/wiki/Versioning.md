# Versioning

## Overview

Project versioning uses git under the hood. Each project directory is a git repository, and every version is a git commit. This enables line-level diffs, efficient storage, and a direct path to GitHub integration.

## How It Works

### Automatic Versioning (Stage Hooks)

The orchestrator auto-commits at pipeline stage boundaries:

- **After each batch** — When a set of concurrent agents completes successfully, the system auto-commits with a label like `"After frontend-dev, styling"`.
- **Pipeline completion** — A final auto-commit captures the end state.

These automatic commits are prefixed with `auto:` and give you rollback points at every stage of the pipeline.

### Manual Versioning

Click "Save Version" in the sidebar's version history panel. Enter a label describing the checkpoint (e.g., "Before refactor", "Working login page"). Manual commits are prefixed with `user:` and tagged with a "saved" badge in the UI.

### Agent Versioning

Development agents (frontend-dev, backend-dev, styling) can call `save_version` during code generation to create explicit checkpoints. This is rate-limited to 3 calls per pipeline run. You can enable/disable this per-agent in Settings > Tools.

### Rollback

1. Open the version history in the sidebar
2. Find the version you want to restore
3. Click "Revert"
4. All project files are restored to that version's state
5. A new `auto: Reverted to <sha>` commit is created (rollback is non-destructive)
6. Bun HMR detects the file changes and updates the preview

### Viewing Diffs

Click the "Diff" button on any version entry to see a GitHub-style unified diff:
- Files listed with addition/deletion counts
- Green lines = additions, red lines = deletions
- Collapsible per-file sections
- Line numbers in gutter

## Git Settings

Configure the git user name and email in Settings > Git tab. These are applied to all new commits. Defaults:
- Name: `Page Gen User`
- Email: `user@pagegen.local`

## API

### List Versions
```
GET /api/versions?projectId={id}
```

### Create Version
```
POST /api/versions
Body: { projectId: string, label: string }
```

### Rollback
```
POST /api/versions/:sha/rollback?projectId={id}
```

### View Diff
```
GET /api/versions/:sha/diff?projectId={id}
```
Returns: `{ diff: string, files: [{ path, additions, deletions }] }`

## Configuration

All versioning constants are in `src/server/config/versioning.ts`:

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_AUTO_VERSIONS_DISPLAY` | 20 | Max auto-commits shown in history |
| `MAX_USER_VERSIONS_DISPLAY` | 50 | Max user-commits shown in history |
| `MAX_AGENT_VERSIONS_PER_RUN` | 3 | Max `save_version` calls per pipeline run |
| `STAGE_HOOKS_ENABLED` | true | Auto-commit between pipeline stages |
| `DEFAULT_GIT_NAME` | Page Gen User | Default commit author name |
| `DEFAULT_GIT_EMAIL` | user@pagegen.local | Default commit author email |

## Security

- **Path sandboxing** — Git operations reject paths outside the `projects/` directory
- **Config isolation** — Global/system git configs are blocked (`GIT_CONFIG_GLOBAL=/dev/null`)
- **Input sanitization** — Control characters stripped from commit messages and config values
- **`.gitignore`** — Auto-created with `node_modules/`, `.env`, `.env.*`, `*.pem`, `credentials*`

## Edge Cases

- **Git not installed** — Version history shows "Git not available" message; pipeline still works normally
- **Nothing to commit** — Returns gracefully with no new version created
- **Existing project without `.git`** — Lazily initialized on first version operation
- **Initial commit diff** — Diffs against the git empty tree SHA when there's no parent commit
