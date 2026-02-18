import { useState } from "react";
import { api } from "../../lib/api.ts";

interface SnapshotDetail {
  id: string;
  label: string;
  fileManifest: string;
  createdAt: number;
}

export function SnapshotDiff({ snapshotId }: { snapshotId: string }) {
  const [snapshot, setSnapshot] = useState<SnapshotDetail | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadSnapshot() {
    setLoading(true);
    try {
      const data = await api.get<SnapshotDetail>(`/snapshots/${snapshotId}`);
      setSnapshot(data);
    } catch {
      console.error("Failed to load snapshot");
    } finally {
      setLoading(false);
    }
  }

  if (!snapshot) {
    return (
      <button
        onClick={loadSnapshot}
        disabled={loading}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        {loading ? "Loading..." : "View files"}
      </button>
    );
  }

  const manifest = JSON.parse(snapshot.fileManifest) as Record<string, string>;
  const files = Object.keys(manifest);

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-zinc-500">{files.length} files in snapshot</p>
      {files.map((file) => (
        <div key={file} className="text-xs text-zinc-400 pl-2">
          {file}
        </div>
      ))}
    </div>
  );
}
