import { useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Loader2 } from "lucide-react";

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
      <Button
        variant="ghost"
        size="sm"
        onClick={loadSnapshot}
        disabled={loading}
        className="text-xs"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
        {loading ? "Loading..." : "View files"}
      </Button>
    );
  }

  const manifest = JSON.parse(snapshot.fileManifest) as Record<string, string>;
  const files = Object.keys(manifest);

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-muted-foreground">{files.length} files in snapshot</p>
      {files.map((file) => (
        <div key={file} className="text-xs text-muted-foreground/80 pl-2">
          {file}
        </div>
      ))}
    </div>
  );
}
