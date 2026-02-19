import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { api } from "../../lib/api.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import type { FileNode } from "../../../shared/types.ts";

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
          className="flex items-center gap-1 w-full text-left py-0.5 hover:bg-zinc-800/50 rounded text-xs"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-zinc-500">{expanded ? "▾" : "▸"}</span>
          <span className="text-zinc-400">{node.name}/</span>
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
      className={`flex items-center w-full text-left py-0.5 rounded text-xs ${
        selectedPath === node.path ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      {node.name}
    </button>
  );
}

export function FileExplorer() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath(null);
    setFileContent(null);
    if (!activeProject) {
      setTree([]);
      return;
    }
    loadTree();
  }, [activeProject]);

  // Auto-refresh tree when files change for this project
  useEffect(() => {
    connectWebSocket();
    const unsub = onWsMessage((msg) => {
      if (
        msg.type === "files_changed" &&
        activeProject &&
        (msg.payload as { projectId?: string }).projectId === activeProject.id
      ) {
        loadTree();
      }
    });
    return unsub;
  }, [activeProject]);

  async function loadTree() {
    if (!activeProject) return;
    try {
      const data = await api.get<FileNode[]>(`/files/tree/${activeProject.id}`);
      setTree(data);
    } catch {
      setTree([]);
    }
  }

  async function handleSelectFile(path: string) {
    if (!activeProject) return;
    setSelectedPath(path);
    try {
      const data = await api.get<{ content: string }>(`/files/read/${activeProject.id}/${path}`);
      setFileContent(data.content);
    } catch {
      setFileContent("Error loading file");
    }
  }

  return (
    <aside className="w-72 border-l border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">Files</h2>
        {activeProject && (
          <button onClick={loadTree} className="text-xs text-zinc-500 hover:text-zinc-300">
            Refresh
          </button>
        )}
      </div>

      {!activeProject ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-zinc-600 p-2">No project selected</p>
        </div>
      ) : tree.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-zinc-600 p-2">No files yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onSelect={handleSelectFile}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}

      {fileContent !== null && (
        <div className="border-t border-zinc-800 max-h-64 overflow-y-auto">
          <div className="p-2 flex items-center justify-between bg-zinc-950">
            <span className="text-xs text-zinc-500 truncate">{selectedPath}</span>
            <button
              onClick={() => {
                setFileContent(null);
                setSelectedPath(null);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              &times;
            </button>
          </div>
          <pre className="p-2 text-xs text-zinc-300 overflow-x-auto whitespace-pre">{fileContent}</pre>
        </div>
      )}
    </aside>
  );
}
