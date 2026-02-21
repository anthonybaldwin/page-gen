import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useProjectStore } from "../../stores/projectStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { api } from "../../lib/api.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Folder, File, FileCode, ChevronRight, Download, RefreshCw, Search, X, Loader2 } from "lucide-react";
import type { FileNode, ContentSearchResult } from "../../../shared/types.ts";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext && ["tsx", "ts", "jsx", "js", "css", "html", "json"].includes(ext)) {
    return <FileCode className="h-3.5 w-3.5 text-primary/60 shrink-0" />;
  }
  return <File className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />;
}

function treeHasFiles(nodes: FileNode[]): boolean {
  return nodes.some(n => n.type === "file" || (n.children != null && treeHasFiles(n.children)));
}

function filterTree(nodes: FileNode[], query: string): FileNode[] {
  const lower = query.toLowerCase();
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "directory") {
      const filteredChildren = filterTree(node.children ?? [], query);
      const nameMatches = node.name.toLowerCase().includes(lower);
      if (nameMatches || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    } else {
      if (node.name.toLowerCase().includes(lower)) {
        result.push(node);
      }
    }
  }
  return result;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lower.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.substring(0, idx)}
      <span className="text-primary font-medium">{text.substring(idx, idx + query.length)}</span>
      {text.substring(idx + query.length)}
    </>
  );
}

function FileTreeNode({
  node,
  depth,
  onSelect,
  onPin,
  selectedPath,
  forceExpanded,
}: {
  node: FileNode;
  depth: number;
  onSelect: (path: string) => void;
  onPin: (path: string) => void;
  selectedPath: string | null;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded || depth < 2);

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

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
              onPin={onPin}
              selectedPath={selectedPath}
              forceExpanded={forceExpanded}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      onDoubleClick={() => onPin(node.path)}
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
  const { openFilePath, openFile, pinFile, handleExternalChange } = useFileStore();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"files" | "content">("files");
  const [contentResults, setContentResults] = useState<ContentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // File name search: debounced filtering
  const [debouncedFileQuery, setDebouncedFileQuery] = useState("");
  useEffect(() => {
    if (searchMode !== "files") return;
    const timer = setTimeout(() => setDebouncedFileQuery(searchQuery), 150);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMode]);

  const filteredTree = useMemo(() => {
    if (!debouncedFileQuery) return tree;
    return filterTree(tree, debouncedFileQuery);
  }, [tree, debouncedFileQuery]);

  // Content search: debounced API call
  const searchContent = useCallback(async (query: string, projectId: string) => {
    if (query.length < 2) {
      setContentResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    try {
      const results = await api.get<ContentSearchResult[]>(
        `/files/search/${projectId}?q=${encodeURIComponent(query)}`
      );
      setContentResults(results);
    } catch {
      setContentResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchMode !== "content" || !activeProject) return;
    if (searchQuery.length < 2) {
      setContentResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(() => {
      searchContent(searchQuery, activeProject.id);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchMode, activeProject, searchContent]);

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
    openFile(activeProject.id, path, { preview: true });
  }

  function handlePinFile(path: string) {
    if (!activeProject) return;
    openFile(activeProject.id, path, { preview: false });
  }

  function clearSearch() {
    setSearchQuery("");
    setContentResults([]);
    searchInputRef.current?.blur();
  }

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      clearSearch();
    }
  }

  const hasFiles = treeHasFiles(tree);
  const hasQuery = searchQuery.length > 0;
  const showFileTree = searchMode === "files";
  const displayTree = hasQuery && showFileTree ? filteredTree : tree;

  if (!activeProject || !hasFiles) return null;

  return (
    <aside className="w-72 border-l border-border bg-card flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Files</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={handleDownload} aria-label="Download project">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={loadTree} aria-label="Refresh file tree">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-2 pt-2 pb-1 space-y-1.5 border-b border-border">
          <div className="flex items-center gap-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={searchMode === "files" ? "Filter files..." : "Search content..."}
              className="h-7 text-xs border-none shadow-none focus-visible:ring-0 px-1"
            />
            {hasQuery && (
              <button
                onClick={clearSearch}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSearchMode("files")}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                searchMode === "files"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Files
            </button>
            <button
              onClick={() => setSearchMode("content")}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                searchMode === "content"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Content
            </button>
          </div>
      </div>

      {searchMode === "content" && hasQuery ? (
        <div className="flex-1 overflow-y-auto py-1">
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : searchQuery.length < 2 ? null : contentResults.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 p-3 text-center">
              No results for &lsquo;{searchQuery}&rsquo;
            </p>
          ) : (
            <div className="space-y-1">
              {contentResults.map((result) => (
                <div key={result.path}>
                  <button
                    onClick={() => handleSelectFile(result.path)}
                    onDoubleClick={() => handlePinFile(result.path)}
                    className={`flex items-center gap-1.5 w-full text-left py-1 px-2 rounded text-xs transition-colors ${
                      openFilePath === result.path
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                  >
                    {getFileIcon(result.path.split("/").pop() ?? "")}
                    <span className="truncate">{result.path}</span>
                  </button>
                  <div className="ml-6 space-y-0.5">
                    {result.matches.map((match) => (
                      <button
                        key={`${result.path}:${match.line}`}
                        onClick={() => handleSelectFile(result.path)}
                        className="flex items-start gap-1.5 w-full text-left py-0.5 px-1 rounded text-xs hover:bg-accent/30 transition-colors"
                      >
                        <span className="text-muted-foreground/50 shrink-0 tabular-nums">{match.line}</span>
                        <span className="text-muted-foreground truncate">
                          <HighlightedText text={match.content} query={searchQuery} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : displayTree.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground/60 p-2">
            No files matching &lsquo;{searchQuery}&rsquo;
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {displayTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              onSelect={handleSelectFile}
              onPin={handlePinFile}
              selectedPath={openFilePath}
              forceExpanded={hasQuery && showFileTree}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
