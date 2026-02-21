import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useVersionStore } from "../../stores/versionStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { api } from "../../lib/api.ts";
import type { VersionEntry } from "../../stores/versionStore.ts";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { RotateCcw, Bookmark, Loader2, GitCommit, ArrowRight, Trash2 } from "lucide-react";

export function VersionHistory() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeVersionSha, startPreview, isPreviewing } = useVersionStore();
  const setActiveTab = useFileStore((s) => s.setActiveTab);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [rolling, setRolling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [label, setLabel] = useState("");
  const [gitUnavailable, setGitUnavailable] = useState(false);

  useEffect(() => {
    if (!activeProject) return;
    loadVersions();
  }, [activeProject]);

  async function loadVersions() {
    if (!activeProject) return;
    try {
      const data = await api.get<VersionEntry[]>(`/versions?projectId=${activeProject.id}`);
      setVersions(data);
      setError(null);
      setGitUnavailable(false);
      // Keep the version store in sync
      useVersionStore.getState().setVersions(data);
    } catch (err: unknown) {
      const errObj = err as { gitUnavailable?: boolean };
      if (errObj?.gitUnavailable) {
        setGitUnavailable(true);
      } else {
        setError("Failed to load versions");
      }
    }
  }

  async function handleRollback(sha: string) {
    if (!activeProject) return;
    setRolling(sha);
    setError(null);
    try {
      await api.post(`/versions/${sha}/rollback?projectId=${activeProject.id}`, {});
      await loadVersions();
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      setError(errObj?.error || "Rollback failed");
    } finally {
      setRolling(null);
    }
  }

  async function handleSaveVersion() {
    if (!activeProject) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ sha: string | null; note?: string }>("/versions", {
        projectId: activeProject.id,
        label: label.trim() || undefined,
      });
      if (!result.sha) {
        setError(result.note || "No changes to save");
      } else {
        setLabel("");
        setShowLabelInput(false);
      }
      await loadVersions();
    } catch {
      setError("Failed to save version");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(sha: string) {
    if (!activeProject) return;
    setDeleting(sha);
    setError(null);
    try {
      await api.delete(`/versions/${sha}?projectId=${activeProject.id}`);
      await loadVersions();
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      setError(errObj?.error || "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  function handleViewDiff(sha: string) {
    if (!activeProject) return;
    startPreview(sha, activeProject.id, versions);
    setActiveTab("preview");
  }

  function stripPrefix(message: string): string {
    return message.replace(/^(auto|user):\s*/i, "");
  }

  function formatTime(timestamp: number): string {
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

  if (!activeProject) return null;

  if (gitUnavailable) {
    return (
      <div className="p-4">
        <p className="text-xs text-muted-foreground/60">Git not available</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {error && (
        <p className="text-xs text-destructive mb-2">{error}</p>
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground/80">Versions</h3>
      </div>

      {/* Bookmark current state — hidden during version preview */}
      {!isPreviewing && <div className="mb-3">
        {showLabelInput ? (
          <div className="flex gap-1">
            <Input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveVersion();
                if (e.key === "Escape") setShowLabelInput(false);
              }}
              placeholder="Name this version..."
              className="h-7 text-xs flex-1"
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleSaveVersion}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-xs text-muted-foreground"
            onClick={() => setShowLabelInput(true)}
          >
            <Bookmark className="h-3 w-3 mr-1.5" />
            Bookmark current version
          </Button>
        )}
      </div>}

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No versions yet</p>
      ) : (
        <div className="space-y-2">
          {versions.map((v, idx) => {
            const isHead = idx === 0;
            const canRollback = !v.isInitial && !isHead;
            const canDelete = !v.isInitial && !isHead;
            return (
              <Card
                key={v.sha}
                className={`px-3 py-2 shadow-none transition-colors ${
                  activeVersionSha === v.sha
                    ? "ring-1 ring-primary/50 bg-primary/5"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <GitCommit className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs text-foreground/80 truncate">{stripPrefix(v.message)}</p>
                        {v.isUserVersion && (
                          <span className="text-[10px] px-1 py-0 rounded bg-primary/10 text-primary shrink-0">
                            saved
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                        <span className="font-mono">{v.sha.slice(0, 7)}</span>
                        <span>{formatTime(v.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-muted-foreground"
                      onClick={() => handleViewDiff(v.sha)}
                    >
                      <ArrowRight className="h-3 w-3 mr-0.5" />
                      View
                    </Button>
                    {canRollback && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-500"
                        onClick={() => handleRollback(v.sha)}
                        disabled={rolling === v.sha}
                      >
                        {rolling === v.sha ? (
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
                        className="h-5 px-1.5 text-[10px] text-destructive/70 hover:text-destructive"
                        onClick={() => handleDelete(v.sha)}
                        disabled={deleting === v.sha}
                      >
                        {deleting === v.sha ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
