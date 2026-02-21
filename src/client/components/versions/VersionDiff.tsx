import { useState, useMemo } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
}

interface DiffResponse {
  diff: string;
  files: DiffFile[];
}

interface DiffHunk {
  file: string;
  additions: number;
  deletions: number;
  lines: { type: "add" | "del" | "context" | "header"; content: string; oldNum?: number; newNum?: number }[];
}

function parseDiffToHunks(rawDiff: string, files: DiffFile[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (current) hunks.push(current);
      const match = line.match(/diff --git a\/(.+) b\//);
      const filePath = match?.[1] || "";
      const fileStats = files.find((f) => f.path === filePath);
      current = {
        file: filePath,
        additions: fileStats?.additions || 0,
        deletions: fileStats?.deletions || 0,
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? parseInt(match[1]!, 10) : 0;
      newLine = match ? parseInt(match[2]!, 10) : 0;
      current.lines.push({ type: "header", content: line });
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) {
      continue;
    }

    if (line.startsWith("+")) {
      current.lines.push({ type: "add", content: line.slice(1), newNum: newLine++ });
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "del", content: line.slice(1), oldNum: oldLine++ });
    } else {
      current.lines.push({ type: "context", content: line.startsWith(" ") ? line.slice(1) : line, oldNum: oldLine++, newNum: newLine++ });
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

function FileHunk({ hunk }: { hunk: DiffHunk }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/50 hover:bg-muted text-xs font-mono text-left"
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="flex-1 truncate">{hunk.file}</span>
        <span className="text-emerald-600 dark:text-emerald-400">+{hunk.additions}</span>
        <span className="text-red-600 dark:text-red-400">-{hunk.deletions}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <tbody>
              {hunk.lines.map((line, i) => {
                if (line.type === "header") {
                  return (
                    <tr key={i} className="bg-blue-500/5">
                      <td colSpan={3} className="px-3 py-0.5 text-blue-600 dark:text-blue-400">{line.content}</td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={i}
                    className={
                      line.type === "add"
                        ? "bg-green-500/10"
                        : line.type === "del"
                        ? "bg-red-500/10"
                        : ""
                    }
                  >
                    <td className="text-muted-foreground/40 text-right px-1 py-0 select-none w-8 border-r border-border/30">
                      {line.oldNum ?? ""}
                    </td>
                    <td className="text-muted-foreground/40 text-right px-1 py-0 select-none w-8 border-r border-border/30">
                      {line.newNum ?? ""}
                    </td>
                    <td
                      className={`px-2 py-0 whitespace-pre ${
                        line.type === "add"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : line.type === "del"
                          ? "text-red-700 dark:text-red-300"
                          : "text-muted-foreground"
                      }`}
                    >
                      {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                      {line.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function VersionDiff({ sha, projectId }: { sha: string; projectId: string }) {
  const [data, setData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hunks = useMemo(() => {
    if (!data) return [];
    return parseDiffToHunks(data.diff, data.files);
  }, [data]);

  async function loadDiff() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<DiffResponse>(`/versions/${sha}/diff?projectId=${projectId}`);
      setData(result);
    } catch {
      setError("Failed to load diff");
    } finally {
      setLoading(false);
    }
  }

  if (!data && !loading) {
    return (
      <Button variant="ghost" size="sm" onClick={loadDiff} className="text-xs h-6 px-2">
        Diff
      </Button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading diff...
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive py-1">{error}</p>;
  }

  if (hunks.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">No changes in this version</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {hunks.length} file{hunks.length !== 1 ? "s" : ""} changed
        </p>
        <Button variant="ghost" size="sm" onClick={() => setData(null)} className="text-xs h-5 px-1 text-muted-foreground/50">
          Close
        </Button>
      </div>
      {hunks.map((hunk, i) => (
        <FileHunk key={i} hunk={hunk} />
      ))}
    </div>
  );
}
