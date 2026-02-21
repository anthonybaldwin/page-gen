# Snapshots & Versioning

## Overview

Snapshots capture the complete file state of a project at a point in time. They enable rollback to any previous state.

## How It Works

### Creation
- **Auto-snapshot (planned, not yet implemented):** Intended to be created automatically after each orchestration run completes. `finishPipeline()` does not currently call `createSnapshot()`.
- **Manual snapshot (API only):** The `POST /api/snapshots` endpoint works. `SnapshotList.tsx` is rendered in the sidebar; `SnapshotDiff.tsx` exists as an orphaned component not yet wired up.
- Each snapshot stores a complete file manifest (JSON mapping of path → content)

### Rollback
- Select any snapshot from the list
- Click "Rollback" to restore all files to that snapshot's state
- Current files are cleared (except node_modules and dotfiles) and replaced
- Vite HMR will detect the file changes and update the preview

### Pruning
- Maximum 10 snapshots per project (hardcoded `MAX_SNAPSHOTS`)
- When the limit is exceeded, the oldest snapshots are automatically deleted
- Pruning happens on every new snapshot creation

## API

### List Snapshots
```
GET /api/snapshots?projectId={id}
```

### Create Snapshot
```
POST /api/snapshots
Body: { projectId: string, label?: string, chatId?: string }
```

### Rollback
```
POST /api/snapshots/{id}/rollback
```

### Get Snapshot Detail
```
GET /api/snapshots/{id}
```
Returns full snapshot including file manifest.

## Safety Rules (from AGENTS.md)

Any change touching snapshot/version logic must:
- Preserve rollback behavior
- Maintain max snapshot pruning
- Include test coverage
- Explicitly state migration impact if format changes
