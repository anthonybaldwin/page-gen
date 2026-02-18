# Snapshots & Versioning

## Overview

Snapshots capture the complete file state of a project at a point in time. They enable rollback to any previous state.

## How It Works

### Creation
- **Auto-snapshot:** Created automatically after each orchestration run completes
- **Manual snapshot:** Users can create snapshots via the UI at any time
- Each snapshot stores a complete file manifest (JSON mapping of path → content)

### Rollback
- Select any snapshot from the list
- Click "Rollback" to restore all files to that snapshot's state
- Current files are cleared (except node_modules and dotfiles) and replaced
- Vite HMR will detect the file changes and update the preview

### Pruning
- Maximum 10 snapshots per project (configurable)
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

## Safety Rules (from CLAUDE.md)

Any change touching snapshot/version logic must:
- Preserve rollback behavior
- Maintain max snapshot pruning
- Include test coverage
- Explicitly state migration impact if format changes
