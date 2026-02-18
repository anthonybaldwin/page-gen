import { broadcastAgentStatus } from "../ws.ts";

// Notify the preview system that files have changed
// The actual HMR is handled by Vite's file watcher
export function notifyPreviewUpdate(projectId: string, changedFiles: string[]) {
  broadcastAgentStatus("preview", "updated", {
    projectId,
    changedFiles,
  });
}
