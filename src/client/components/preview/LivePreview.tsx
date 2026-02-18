import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";

const PREVIEW_BASE_PORT = 3001;

export function LivePreview() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProject) {
      setPreviewUrl(null);
      return;
    }

    setLoading(true);
    setError(null);

    // Request preview server start for this project
    fetch(`/api/files/preview/${activeProject.id}`, { method: "POST" })
      .then((res) => res.json())
      .then((data: { url?: string; error?: string }) => {
        if (data.url) {
          setPreviewUrl(data.url);
        } else if (data.error) {
          setError(data.error);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to start preview server");
        setLoading(false);
      });
  }, [activeProject]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="text-zinc-500 text-sm">Select a project to preview</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">Starting preview server...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <p className="text-red-400 text-sm mb-2">{error}</p>
          <p className="text-zinc-500 text-xs">
            Preview will be available after agents generate code.
          </p>
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="text-zinc-500 text-sm">
          Preview will appear here when agents generate code.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-zinc-950">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
        <div className="w-2 h-2 rounded-full bg-green-400" />
        <span className="text-xs text-zinc-400 truncate">{previewUrl}</span>
        <button
          onClick={() => {
            const iframe = document.querySelector<HTMLIFrameElement>("#preview-iframe");
            if (iframe) iframe.src = iframe.src;
          }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
        >
          Reload
        </button>
      </div>
      <iframe
        id="preview-iframe"
        src={previewUrl}
        className="flex-1 w-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Live Preview"
      />
    </div>
  );
}
