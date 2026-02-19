import { useEffect, useState, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";

export function LivePreview() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  // Auto-reload iframe when agents write new files (HMR fallback)
  useEffect(() => {
    if (!previewUrl || !activeProject) return;
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (msg.type === "files_changed" || msg.type === "preview_ready") {
        // Give Vite a moment to pick up the changes, then reload
        setTimeout(() => {
          if (iframeRef.current) {
            iframeRef.current.src = previewUrl;
          }
        }, 1000);
      }
    });

    return unsub;
  }, [previewUrl, activeProject]);

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
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              fetch(`/api/files/preview/${activeProject.id}`, { method: "POST" })
                .then((res) => res.json())
                .then((data: { url?: string; error?: string }) => {
                  if (data.url) setPreviewUrl(data.url);
                  else if (data.error) setError(data.error);
                  setLoading(false);
                })
                .catch(() => {
                  setError("Failed to start preview server");
                  setLoading(false);
                });
            }}
            className="text-blue-400 hover:text-blue-300 text-xs underline"
          >
            Retry
          </button>
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
            if (iframeRef.current) iframeRef.current.src = previewUrl;
          }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
        >
          Reload
        </button>
      </div>
      <iframe
        ref={iframeRef}
        id="preview-iframe"
        src={previewUrl}
        className="flex-1 w-full bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title="Live Preview"
      />
    </div>
  );
}
