import { useState, useEffect, useMemo, useRef } from "react";
import { useVersionStore } from "../../stores/versionStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { ScrollArea } from "../ui/scroll-area.tsx";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  X,
  Loader2,
  FileText,
  FolderOpen,
  GitCommit,
} from "lucide-react";
import {
  FileHunk,
  parseDiffToHunks,
  type DiffResponse,
  type DiffHunk,
} from "./VersionDiff.tsx";

type ViewMode = "changes" | "files";

function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function stripPrefix(message: string): string {
  return message.replace(/^(auto|user):\s*/i, "");
}

function FileTree({ files }: { files: string[] }) {
  // Build a tree structure from flat paths
  interface TreeNode {
    name: string;
    children: Map<string, TreeNode>;
    isFile: boolean;
  }

  const tree = useMemo(() => {
    const root: TreeNode = { name: "", children: new Map(), isFile: false };
    for (const filePath of files) {
      const parts = filePath.split("/");
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            children: new Map(),
            isFile: i === parts.length - 1,
          });
        }
        current = current.children.get(part)!;
      }
    }
    return root;
  }, [files]);

  function renderNode(node: TreeNode, depth: number): React.ReactNode[] {
    const sorted = Array.from(node.children.entries()).sort(([, a], [, b]) => {
      // Folders first, then files
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return sorted.map(([key, child]) => (
      <div key={key}>
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono text-muted-foreground hover:bg-muted/50 rounded"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {child.isFile ? (
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          ) : (
            <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          )}
          <span className="truncate">{child.name}</span>
        </div>
        {!child.isFile && renderNode(child, depth + 1)}
      </div>
    ));
  }

  return <div className="py-1">{renderNode(tree, 0)}</div>;
}

export function VersionPanel() {
  const { activeVersionSha, projectId, versions, closeVersion, setActiveVersionSha } =
    useVersionStore();
  const setActiveTab = useFileStore((s) => s.setActiveTab);

  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [treeFiles, setTreeFiles] = useState<string[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("changes");
  const [rolling, setRolling] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const hunks = useMemo(() => {
    if (!diffData) return [];
    return parseDiffToHunks(diffData.diff, diffData.files);
  }, [diffData]);

  const currentVersion = versions.find((v) => v.sha === activeVersionSha);
  const currentIndex = versions.findIndex((v) => v.sha === activeVersionSha);
  const hasPrev = currentIndex < versions.length - 1;
  const hasNext = currentIndex > 0;

  // Load diff when sha changes
  useEffect(() => {
    if (!activeVersionSha || !projectId) return;
    setDiffData(null);
    setDiffError(null);
    setDiffLoading(true);
    api
      .get<DiffResponse>(`/versions/${activeVersionSha}/diff?projectId=${projectId}`)
      .then(setDiffData)
      .catch(() => setDiffError("Failed to load diff"))
      .finally(() => setDiffLoading(false));
  }, [activeVersionSha, projectId]);

  // Load file tree when sha changes and in files mode
  useEffect(() => {
    if (!activeVersionSha || !projectId || viewMode !== "files") return;
    setTreeFiles(null);
    setTreeLoading(true);
    api
      .get<{ files: string[] }>(`/versions/${activeVersionSha}/tree?projectId=${projectId}`)
      .then((data) => setTreeFiles(data.files))
      .catch(() => setTreeFiles(null))
      .finally(() => setTreeLoading(false));
  }, [activeVersionSha, projectId, viewMode]);

  function handleClose() {
    closeVersion();
    setActiveTab("preview");
  }

  function handlePrev() {
    if (!hasPrev) return;
    const prev = versions[currentIndex + 1];
    if (prev) setActiveVersionSha(prev.sha);
  }

  function handleNext() {
    if (!hasNext) return;
    const next = versions[currentIndex - 1];
    if (next) setActiveVersionSha(next.sha);
  }

  async function handleRollback() {
    if (!activeVersionSha || !projectId) return;
    setRolling(true);
    setRollbackError(null);
    try {
      await api.post(`/versions/${activeVersionSha}/rollback?projectId=${projectId}`, {});
    } catch (err: unknown) {
      const errObj = err as { error?: string };
      setRollbackError(errObj?.error || "Rollback failed");
    } finally {
      setRolling(false);
    }
  }

  function scrollToFile(filePath: string) {
    const el = fileRefs.current[filePath];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!activeVersionSha || !projectId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No version selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleClose}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <GitCommit className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">
            {currentVersion ? stripPrefix(currentVersion.message) : activeVersionSha.slice(0, 7)}
          </span>
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {activeVersionSha.slice(0, 7)}
          </span>
          {currentVersion && (
            <span className="text-xs text-muted-foreground shrink-0">
              {formatRelativeTime(currentVersion.timestamp)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handlePrev}
            disabled={!hasPrev}
            title="Older version"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleNext}
            disabled={!hasNext}
            title="Newer version"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>

          <div className="w-px h-5 bg-border mx-1" />

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500"
            onClick={handleRollback}
            disabled={rolling}
          >
            {rolling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
            )}
            Rollback
          </Button>

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Rollback error */}
      {rollbackError && (
        <div className="px-4 py-1.5 bg-destructive/10 text-destructive text-xs border-b border-border">
          {rollbackError}
        </div>
      )}

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — file list */}
        <div className="w-52 border-r border-border flex flex-col shrink-0">
          {/* View mode toggle */}
          <div className="flex border-b border-border shrink-0">
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "changes"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("changes")}
            >
              Changes
            </button>
            <button
              type="button"
              className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "files"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode("files")}
            >
              Files
            </button>
          </div>

          <ScrollArea className="flex-1">
            {viewMode === "changes" ? (
              <div className="py-1">
                {diffLoading && (
                  <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </div>
                )}
                {!diffLoading && hunks.length === 0 && !diffError && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No changes</p>
                )}
                {hunks.length > 0 && (
                  <>
                    <p className="px-3 py-1 text-[10px] text-muted-foreground/60">
                      {hunks.length} file{hunks.length !== 1 ? "s" : ""} changed
                    </p>
                    {hunks.map((hunk) => (
                      <button
                        key={hunk.file}
                        type="button"
                        className="w-full flex items-center gap-1.5 px-3 py-1 text-xs hover:bg-muted/50 text-left"
                        onClick={() => scrollToFile(hunk.file)}
                      >
                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                        <span className="truncate flex-1 font-mono text-foreground/80">
                          {hunk.file.split("/").pop()}
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">
                          +{hunk.additions}
                        </span>
                        <span className="text-red-600 dark:text-red-400 text-[10px]">
                          -{hunk.deletions}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div>
                {treeLoading && (
                  <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading...
                  </div>
                )}
                {!treeLoading && treeFiles && <FileTree files={treeFiles} />}
                {!treeLoading && !treeFiles && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">File tree unavailable</p>
                )}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right — diff content */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-3">
            {diffLoading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading diff...
              </div>
            )}

            {diffError && (
              <p className="text-sm text-destructive text-center py-8">{diffError}</p>
            )}

            {!diffLoading && !diffError && hunks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No changes in this version
              </p>
            )}

            {hunks.map((hunk, i) => (
              <div
                key={i}
                ref={(el) => {
                  fileRefs.current[hunk.file] = el;
                }}
              >
                <FileHunk hunk={hunk} />
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
