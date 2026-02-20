import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { api } from "../../lib/api.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { Button } from "../ui/button.tsx";
import { Folder, File, FileCode, ChevronRight, Download, RefreshCw } from "lucide-react";
import type { FileNode } from "../../../shared/types.ts";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext && ["tsx", "ts", "jsx", "js", "css", "html", "json"].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 text-primary/60 shrink-0" />;
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />;
}

function FileTreeNode({
  node,
  depth,
  onSelect,
  selectedPath,
}: {
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-accent/50 rounded text-xs transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight className={`h-3 w-3 text-muted-foreground/50 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
          <Folder className="h-3.5 w-3.5 text-primary/50 shrink-0" />
          <span className="text-muted-foreground">{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full text-left py-0.5 rounded text-xs transition-colors ${
        selectedPath === node.path ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      {getFileIcon(node.name)}
      {node.name}
    </button>
  );
}

export function FileExplorer() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { openFilePath, openFile, handleExternalChange } = useFileStore();
  const [tree, setTree] = useState<FileNode[]>([]);

  useEffect(() => {
    if (!activeProject) {
      setTree([]);
      return;
    }
    loadTree();
  }, [activeProject]);

  useEffect(() => {
    connectWebSocket();
    const unsub = onWsMessage((msg) => {
      if (
        msg.type === "files_changed" &&
        activeProject &&
        (msg.payload as { projectId?: string }).projectId === activeProject.id
      ) {
        loadTree();
        const paths = (msg.payload as { paths?: string[] }).paths ?? [];
        handleExternalChange(activeProject.id, paths);
      }
    });
    return unsub;
  }, [activeProject, handleExternalChange]);

  async function loadTree() {
    if (!activeProject) return;
    try {
      const data = await api.get<FileNode[]>(`/files/tree/${activeProject.id}`);
      setTree(data);
    } catch {
      setTree([]);
    }
  }

  async function handleDownload() {
    if (!activeProject) return;
    try {
      const res = await fetch(`/api/files/zip/${activeProject.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeProject.name || activeProject.id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // download failed silently
    }
  }

  function handleSelectFile(path: string) {
    if (!activeProject) return;
    openFile(activeProject.id, path);
  }

  return (
    <aside className="w-72 border-l border-border bg-card flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
        {activeProject && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={handleDownload} aria-label="Download project">
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={loadTree} aria-label="Refresh file tree">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {!activeProject ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground/60 p-2">No project selected</p>
        </div>
      ) : tree.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground/60 p-2">No files yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onSelect={handleSelectFile}
              selectedPath={openFilePath}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
