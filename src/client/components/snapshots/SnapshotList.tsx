import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { api } from "../../lib/api.ts";

interface SnapshotSummary {
  id: string;
  label: string;
  createdAt: number;
}

export function SnapshotList() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [rolling, setRolling] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject) return;
    loadSnapshots();
  }, [activeProject]);

  async function loadSnapshots() {
    if (!activeProject) return;
    const data = await api.get<SnapshotSummary[]>(`/snapshots?projectId=${activeProject.id}`);
    setSnapshots(data);
  }

  async function handleRollback(id: string) {
    setRolling(id);
    try {
      await api.post(`/snapshots/${id}/rollback`, {});
      await loadSnapshots();
    } catch (err) {
      console.error("Rollback failed:", err);
    } finally {
      setRolling(null);
    }
  }

  async function handleCreateSnapshot() {
    if (!activeProject) return;
    await api.post("/snapshots", { projectId: activeProject.id, label: `Manual snapshot` });
    await loadSnapshots();
  }

  if (!activeProject) return null;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">Snapshots</h3>
        <button
          onClick={handleCreateSnapshot}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          Create Snapshot
        </button>
      </div>

      {snapshots.length === 0 ? (
        <p className="text-xs text-zinc-600">No snapshots yet</p>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className="flex items-center justify-between rounded-lg bg-zinc-800 px-3 py-2"
            >
              <div>
                <p className="text-xs text-zinc-300">{snap.label}</p>
                <p className="text-xs text-zinc-600">
                  {new Date(snap.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => handleRollback(snap.id)}
                disabled={rolling === snap.id}
                className="text-xs text-yellow-400 hover:text-yellow-300 disabled:opacity-50"
              >
                {rolling === snap.id ? "Rolling back..." : "Rollback"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
