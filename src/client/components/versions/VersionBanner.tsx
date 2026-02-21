import { useState } from "react";
import { useVersionStore } from "../../stores/versionStore.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import {
  GitCommit,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Trash2,
  X,
  Loader2,
} from "lucide-react";

function stripPrefix(message: string): string {
  return message.replace(/^(auto|user):\s*/i, "");
}

function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

export function VersionBanner() {
  const {
    isPreviewing,
    previewSha,
    projectId,
    versions,
    stopPreview,
    navigatePreview,
  } = useVersionStore();

  const [rolling, setRolling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isPreviewing || !previewSha || !projectId) return null;

  const currentVersion = versions.find((v) => v.sha === previewSha);
  const currentIndex = versions.findIndex((v) => v.sha === previewSha);
  const hasPrev = currentIndex < versions.length - 1;
  const hasNext = currentIndex > 0;
  const isHead = currentIndex === 0;
  const isInitial = currentVersion?.isInitial ?? false;
  const canRollback = !isInitial && !isHead;
  const canDelete = !isInitial && !isHead;

  function handlePrev() {
    if (!hasPrev) return;
    const prev = versions[currentIndex + 1];
    if (prev) navigatePreview(prev.sha, projectId!);
  }

  function handleNext() {
    if (!hasNext) return;
    const next = versions[currentIndex - 1];
    if (next) navigatePreview(next.sha, projectId!);
  }

  async function handleRollback() {
    if (!previewSha || !projectId) return;
    setRolling(true);
    setError(null);
    try {
      await stopPreview(projectId);
      await api.post(`/versions/${previewSha}/rollback?projectId=${projectId}`, {});
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      setError(errObj?.error || "Rollback failed");
    } finally {
      setRolling(false);
    }
  }

  async function handleDelete() {
    if (!previewSha || !projectId) return;
    setDeleting(true);
    setError(null);
    try {
      // Navigate to adjacent version first, or exit
      if (hasPrev) {
        const prev = versions[currentIndex + 1];
        if (prev) {
          await navigatePreview(prev.sha, projectId);
        }
      } else if (hasNext) {
        const next = versions[currentIndex - 1];
        if (next) {
          await navigatePreview(next.sha, projectId);
        }
      } else {
        await stopPreview(projectId);
      }
      await api.delete(`/versions/${previewSha}?projectId=${projectId}`);
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      setError(errObj?.error || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function handleExit() {
    stopPreview(projectId!);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 shrink-0">
      <GitCommit className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-xs font-medium text-amber-700 dark:text-amber-300 shrink-0">
        Viewing:
      </span>
      <span className="text-xs text-foreground/80 truncate min-w-0">
        {currentVersion ? stripPrefix(currentVersion.message) : previewSha.slice(0, 7)}
      </span>
      <span className="text-xs font-mono text-muted-foreground shrink-0">
        {previewSha.slice(0, 7)}
      </span>
      {currentVersion && (
        <span className="text-xs text-muted-foreground shrink-0">
          {formatRelativeTime(currentVersion.timestamp)}
        </span>
      )}

      {error && (
        <span className="text-xs text-destructive shrink-0">{error}</span>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={handlePrev}
          disabled={!hasPrev}
          title="Older version"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={handleNext}
          disabled={!hasNext}
          title="Newer version"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-4 bg-border mx-0.5" />

        {canRollback && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500"
            onClick={handleRollback}
            disabled={rolling}
            title="Rollback to this version"
          >
            {rolling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
          </Button>
        )}

        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-destructive/70 hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete this version"
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        )}

        <div className="w-px h-4 bg-border mx-0.5" />

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={handleExit}
          title="Exit version preview"
        >
          <X className="h-3.5 w-3.5" />
          <span className="ml-0.5">Exit</span>
        </Button>
      </div>
    </div>
  );
}
