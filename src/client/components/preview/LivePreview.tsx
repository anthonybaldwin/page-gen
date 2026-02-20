import { useEffect, useState, useRef, useCallback } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { RefreshCw, Loader2 } from "lucide-react";
import type { FileNode } from "../../../shared/types.ts";

function hasAppComponent(tree: FileNode[]): boolean {
  const srcDir = tree.find((n) => n.name === "src" && n.type === "directory");
  if (!srcDir?.children) return false;
  return srcDir.children.some(
    (n) => n.type === "file" && (n.name === "App.tsx" || n.name === "App.jsx" || n.name === "app.tsx"),
  );
}

function EmptyProjectPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-background gap-6 px-8">
      <svg
        width="200"
        height="160"
        viewBox="0 0 200 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-20"
      >
        <rect x="20" y="16" width="160" height="112" rx="8" className="stroke-muted-foreground" strokeWidth="1.5" />
        <line x1="20" y1="36" x2="180" y2="36" className="stroke-muted-foreground" strokeWidth="1.5" />
        <circle cx="34" cy="26" r="3" fill="#ef4444" opacity="0.6" />
        <circle cx="46" cy="26" r="3" fill="#eab308" opacity="0.6" />
        <circle cx="58" cy="26" r="3" fill="#22c55e" opacity="0.6" />
        <rect x="72" y="22" width="96" height="8" rx="4" className="fill-muted" />
        <rect x="36" y="48" width="48" height="4" rx="2" className="fill-primary" opacity="0.4" />
        <rect x="36" y="58" width="72" height="4" rx="2" className="fill-muted-foreground" opacity="0.3" />
        <rect x="44" y="68" width="56" height="4" rx="2" fill="#a78bfa" opacity="0.35" />
        <rect x="44" y="78" width="80" height="4" rx="2" className="fill-muted-foreground" opacity="0.3" />
        <rect x="44" y="88" width="40" height="4" rx="2" fill="#34d399" opacity="0.35" />
        <rect x="36" y="98" width="32" height="4" rx="2" className="fill-primary" opacity="0.4" />
        <rect x="36" y="108" width="64" height="4" rx="2" className="fill-muted-foreground" opacity="0.3" />
        <rect x="100" y="108" width="2" height="4" rx="1" className="fill-primary" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0;0.7" dur="1.2s" repeatCount="indefinite" />
        </rect>
      </svg>
      <div className="text-center space-y-2 max-w-xs">
        <p className="text-sm text-muted-foreground">
          Your live preview will appear here
        </p>
        <p className="text-xs text-muted-foreground/60">
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
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [serverAlive, setServerAlive] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const prevProjectRef = useRef<string | null>(null);

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

  useEffect(() => {
    const prevId = prevProjectRef.current;
    if (prevId && prevId !== activeProject?.id) {
      fetch(`/api/files/preview/${prevId}`, { method: "DELETE" }).catch(() => {});
    }
    prevProjectRef.current = activeProject?.id ?? null;

    setPreviewUrl(null);
    setLoading(false);
    setError(null);
    setReady(false);
    setServerAlive(true);

    if (!activeProject) return;

    checkAndMaybeStartPreview(activeProject.id);

    return () => {
      if (activeProject) {
        fetch(`/api/files/preview/${activeProject.id}`, { method: "DELETE" }).catch(() => {});
      }
    };
  }, [activeProject, checkAndMaybeStartPreview]);

  useEffect(() => {
    if (!previewUrl || !activeProject) return;
    let cancelled = false;

    const check = async () => {
      try {
        await fetch(previewUrl, { mode: "no-cors", signal: AbortSignal.timeout(2000) });
        if (!cancelled) setServerAlive(true);
      } catch {
        if (!cancelled) {
          setServerAlive(false);
          if (!loading) {
            checkAndMaybeStartPreview(activeProject.id);
          }
        }
      }
    };

    const interval = setInterval(check, 5000);
    check();

    return () => { cancelled = true; clearInterval(interval); };
  }, [previewUrl, activeProject, loading, checkAndMaybeStartPreview]);

  useEffect(() => {
    if (!activeProject) return;
    connectWebSocket();

    const unsub = onWsMessage((msg) => {
      if (msg.type === "agent_status") {
        const { agentName, status } = msg.payload as { agentName: string; status: string };
        if (agentName === "orchestrator") {
          if (status === "running") setPipelineRunning(true);
          if (["completed", "stopped", "failed"].includes(status)) setPipelineRunning(false);
        }
      }

      if (msg.type === "preview_ready") {
        setServerAlive(true);
        if (previewUrl && iframeRef.current) {
          setTimeout(() => {
            if (iframeRef.current && previewUrl) iframeRef.current.src = previewUrl;
          }, 300);
        } else if (!previewUrl && !loading) {
          checkAndMaybeStartPreview(activeProject.id);
        }
      }
      if (msg.type === "files_changed" && !pipelineRunning && previewUrl && iframeRef.current) {
        setTimeout(() => {
          if (iframeRef.current && previewUrl) iframeRef.current.src = previewUrl;
        }, 300);
      }
    });

    return unsub;
  }, [previewUrl, loading, activeProject, pipelineRunning, checkAndMaybeStartPreview]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Select a project to preview</p>
      </div>
    );
  }

  if (!ready && !loading && !error) {
    return <EmptyProjectPlaceholder />;
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Starting preview server...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-destructive text-sm mb-2">{error}</p>
          <Button
            variant="link"
            size="sm"
            onClick={() => startPreview(activeProject.id)}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!previewUrl) {
    return <EmptyProjectPlaceholder />;
  }

  const showOverlay = !serverAlive || (pipelineRunning && !serverAlive);

  return (
    <div className="flex-1 flex flex-col bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card">
        <div className={`w-2 h-2 rounded-full ${serverAlive ? "bg-emerald-500" : "bg-amber-400 animate-pulse"}`} />
        <span className="text-xs text-muted-foreground truncate">{previewUrl}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2"
          onClick={() => {
            if (iframeRef.current) iframeRef.current.src = previewUrl;
          }}
          aria-label="Reload preview"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 relative" style={{ backgroundColor: "#ffffff" }}>
        <iframe
          ref={iframeRef}
          id="preview-iframe"
          src={previewUrl}
          className={`absolute inset-0 w-full h-full ${showOverlay ? "invisible" : ""}`}
          sandbox="allow-scripts allow-same-origin allow-forms"
          style={{ colorScheme: "normal" }}
          title="Live Preview"
        />
        {showOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ backgroundColor: "#ffffff", color: "#6b7280" }}>
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#6366f1" }} />
            <p className="text-sm">
              {pipelineRunning ? "Agents are building — preview will reload when ready" : "Preview server restarting..."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
