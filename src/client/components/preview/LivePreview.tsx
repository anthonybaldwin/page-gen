import { useEffect, useState, useRef, useCallback } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { api } from "../../lib/api.ts";
import type { FileNode } from "../../../shared/types.ts";

/** Check if the tree contains src/App.tsx or src/App.jsx — the scaffold imports ./App */
function hasAppComponent(tree: FileNode[]): boolean {
  const srcDir = tree.find((n) => n.name === "src" && n.type === "directory");
  if (!srcDir?.children) return false;
  return srcDir.children.some(
    (n) => n.type === "file" && (n.name === "App.tsx" || n.name === "App.jsx" || n.name === "app.tsx"),
  );
}

function EmptyProjectPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 gap-6 px-8">
      <svg
        width="200"
        height="160"
        viewBox="0 0 200 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-30"
      >
        {/* Browser window frame */}
        <rect x="20" y="16" width="160" height="112" rx="8" stroke="#71717a" strokeWidth="1.5" />
        <line x1="20" y1="36" x2="180" y2="36" stroke="#71717a" strokeWidth="1.5" />
        {/* Window dots */}
        <circle cx="34" cy="26" r="3" fill="#ef4444" opacity="0.6" />
        <circle cx="46" cy="26" r="3" fill="#eab308" opacity="0.6" />
        <circle cx="58" cy="26" r="3" fill="#22c55e" opacity="0.6" />
        {/* Address bar */}
        <rect x="72" y="22" width="96" height="8" rx="4" fill="#27272a" />
        {/* Code lines */}
        <rect x="36" y="48" width="48" height="4" rx="2" fill="#3b82f6" opacity="0.4" />
        <rect x="36" y="58" width="72" height="4" rx="2" fill="#71717a" opacity="0.3" />
        <rect x="44" y="68" width="56" height="4" rx="2" fill="#a78bfa" opacity="0.35" />
        <rect x="44" y="78" width="80" height="4" rx="2" fill="#71717a" opacity="0.3" />
        <rect x="44" y="88" width="40" height="4" rx="2" fill="#34d399" opacity="0.35" />
        <rect x="36" y="98" width="32" height="4" rx="2" fill="#3b82f6" opacity="0.4" />
        <rect x="36" y="108" width="64" height="4" rx="2" fill="#71717a" opacity="0.3" />
        {/* Cursor blink line */}
        <rect x="100" y="108" width="2" height="4" rx="1" fill="#3b82f6" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0;0.7" dur="1.2s" repeatCount="indefinite" />
        </rect>
      </svg>
      <div className="text-center space-y-2 max-w-xs">
        <p className="text-sm text-zinc-400">
          Your live preview will appear here
        </p>
        <p className="text-xs text-zinc-600">
          Describe what you want to build in the chat and agents will generate the code.
        </p>
      </div>
    </div>
  );
}

export function LivePreview() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const startPreview = useCallback(async (projectId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/preview/${projectId}`, { method: "POST" });
      const data: { url?: string; error?: string } = await res.json();
      if (data.url) {
        setPreviewUrl(data.url);
      } else if (data.error) {
        setError(data.error);
      }
    } catch {
      setError("Failed to start preview server");
    }
    setLoading(false);
  }, []);

  const checkAndMaybeStartPreview = useCallback(async (projectId: string) => {
    try {
      const tree = await api.get<FileNode[]>(`/files/tree/${projectId}`);
      if (hasAppComponent(tree)) {
        setReady(true);
        await startPreview(projectId);
      }
    } catch {
      // tree fetch failed — stay in placeholder
    }
  }, [startPreview]);

  // Reset ALL state when project changes, then check for files
  useEffect(() => {
    setPreviewUrl(null);
    setLoading(false);
    setError(null);
    setReady(false);

    if (!activeProject) return;

    checkAndMaybeStartPreview(activeProject.id);
  }, [activeProject, checkAndMaybeStartPreview]);

  // Listen for file changes — start preview if files appear, reload if already running
  useEffect(() => {
    if (!activeProject) return;
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      // Only start the preview on preview_ready (sent after a successful build check)
      if (msg.type === "preview_ready") {
        if (previewUrl && iframeRef.current) {
          setTimeout(() => {
            if (iframeRef.current && previewUrl) iframeRef.current.src = previewUrl;
          }, 1000);
        } else if (!previewUrl && !loading) {
          checkAndMaybeStartPreview(activeProject.id);
        }
      }
      // files_changed only reloads an already-running preview — never starts one
      if (msg.type === "files_changed" && previewUrl && iframeRef.current) {
        setTimeout(() => {
          if (iframeRef.current && previewUrl) iframeRef.current.src = previewUrl;
        }, 1000);
      }
    });

    return unsub;
  }, [previewUrl, loading, activeProject, checkAndMaybeStartPreview]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <p className="text-zinc-500 text-sm">Select a project to preview</p>
      </div>
    );
  }

  if (!ready && !loading && !error) {
    return <EmptyProjectPlaceholder />;
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
            onClick={() => startPreview(activeProject.id)}
            className="text-blue-400 hover:text-blue-300 text-xs underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return <EmptyProjectPlaceholder />;
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
