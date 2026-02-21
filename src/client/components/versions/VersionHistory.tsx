import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { RotateCcw, Save, Loader2, GitCommit } from "lucide-react";
import { VersionDiff } from "./VersionDiff.tsx";

interface VersionEntry {
  sha: string;
  email: string;
  message: string;
  timestamp: number;
  isUserVersion: boolean;
}

export function VersionHistory() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [rolling, setRolling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [label, setLabel] = useState("");
  const [gitUnavailable, setGitUnavailable] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);

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
    try {
      await api.post(`/versions/${sha}/rollback?projectId=${activeProject.id}`, {});
      await loadVersions();
    } catch {
      setError("Rollback failed");
    } finally {
      setRolling(null);
    }
  }

  async function handleSaveVersion() {
    if (!activeProject) return;
    setSaving(true);
    try {
      await api.post("/versions", {
        projectId: activeProject.id,
        label: label.trim() || undefined,
      });
      setLabel("");
      setShowLabelInput(false);
      await loadVersions();
    } catch {
      setError("Failed to save version");
    } finally {
      setSaving(false);
    }
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
              placeholder="Label..."
              className="h-6 text-xs w-32"
              autoFocus
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleSaveVersion}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setShowLabelInput(true)}
          >
            <Save className="h-3 w-3 mr-1" />
            Save
          </Button>
        )}
      </div>

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No versions yet</p>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => (
            <Card
              key={v.sha}
              className="px-3 py-2 shadow-none"
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
                    onClick={() => setExpandedDiff(expandedDiff === v.sha ? null : v.sha)}
                  >
                    Diff
                  </Button>
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
                </div>
              </div>
              {expandedDiff === v.sha && activeProject && (
                <VersionDiff sha={v.sha} projectId={activeProject.id} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
