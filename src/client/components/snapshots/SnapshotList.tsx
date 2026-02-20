import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Card } from "../ui/card.tsx";
import { RotateCcw, Plus, Loader2 } from "lucide-react";

interface SnapshotSummary {
  id: string;
  label: string;
  createdAt: number;
}

export function SnapshotList() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [rolling, setRolling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    loadSnapshots();
  }, [activeProject]);

  async function loadSnapshots() {
    if (!activeProject) return;
    try {
      const data = await api.get<SnapshotSummary[]>(`/snapshots?projectId=${activeProject.id}`);
      setSnapshots(data);
      setError(null);
    } catch (err) {
      console.error("[snapshots] Failed to load:", err);
      setError("Failed to load snapshots");
    }
  }

  async function handleRollback(id: string) {
    setRolling(id);
    try {
      await api.post(`/snapshots/${id}/rollback`, {});
      await loadSnapshots();
    } catch (err) {
      console.error("[snapshots] Rollback failed:", err);
      setError("Rollback failed");
    } finally {
      setRolling(null);
    }
  }

  async function handleCreateSnapshot() {
    if (!activeProject) return;
    try {
      await api.post("/snapshots", { projectId: activeProject.id, label: `Manual snapshot` });
      await loadSnapshots();
    } catch (err) {
      console.error("[snapshots] Failed to create:", err);
      setError("Failed to create snapshot");
    }
  }

  if (!activeProject) return null;

  return (
    <div className="p-4">
      {error && (
        <p className="text-xs text-destructive mb-2">{error}</p>
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground/80">Snapshots</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={handleCreateSnapshot}
        >
          <Plus className="h-3 w-3 mr-1" />
          Create
        </Button>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No snapshots yet</p>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snap) => (
            <Card
              key={snap.id}
              className="flex items-center justify-between px-3 py-2 shadow-none"
            >
              <div>
                <p className="text-xs text-foreground/80">{snap.label}</p>
                <p className="text-xs text-muted-foreground/60">
                  {new Date(snap.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500"
                onClick={() => handleRollback(snap.id)}
                disabled={rolling === snap.id}
              >
                {rolling === snap.id ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <RotateCcw className="h-3 w-3 mr-1" />
                )}
                {rolling === snap.id ? "Rolling back..." : "Rollback"}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
