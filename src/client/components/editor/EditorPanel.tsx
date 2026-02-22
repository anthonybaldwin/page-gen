import { useFileStore } from "../../stores/fileStore.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { Button } from "../ui/button.tsx";
import { Loader2, FileCode } from "lucide-react";

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg",
]);

const BINARY_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "woff", "woff2", "ttf", "eot", "otf",
  "mp3", "mp4", "wav", "ogg", "webm", "avi",
  "pdf", "zip", "tar", "gz", "rar", "7z",
  "exe", "dll", "so", "dylib", "bin",
  "db", "sqlite", "sqlite3",
]);

function getFileExt(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function ImagePreview({ path, projectId }: { path: string; projectId: string }) {
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <span className="text-xs text-muted-foreground truncate">{path}</span>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] overflow-auto p-6">
        <img
          src={`/api/files/raw/${projectId}/${path}`}
          alt={path.split("/").pop() ?? ""}
          className="max-w-full max-h-full object-contain rounded shadow-sm"
        />
      </div>
    </div>
  );
}

function UnsupportedFilePreview({ path }: { path: string }) {
  const fileName = path.split("/").pop() ?? path;
  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <span className="text-xs text-muted-foreground truncate">{path}</span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center bg-background gap-6 px-8">
        <svg
          width="200"
          height="160"
          viewBox="0 0 200 160"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="opacity-20"
        >
          {/* File shape */}
          <path
            d="M60 20h50l30 30v90a8 8 0 01-8 8H68a8 8 0 01-8-8V20z"
            className="stroke-muted-foreground"
            strokeWidth="1.5"
          />
          <path d="M110 20v22a8 8 0 008 8h22" className="stroke-muted-foreground" strokeWidth="1.5" />
          {/* X mark */}
          <line x1="82" y1="75" x2="118" y2="111" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
          <line x1="118" y1="75" x2="82" y2="111" className="stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <div className="text-center space-y-2 max-w-xs">
          <p className="text-sm text-muted-foreground">
            Unable to display this file
          </p>
          <p className="text-xs text-muted-foreground/60">
            {fileName}
          </p>
        </div>
      </div>
    </div>
  );
}

export function EditorPanel() {
  const { openFilePath, openFileProjectId, isLoading, externallyChanged, acceptExternal, dismissExternal } = useFileStore();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Loading file...</p>
        </div>
      </div>
    );
  }

  if (!openFilePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background gap-4 px-8">
        <FileCode className="h-12 w-12 text-muted-foreground/20" />
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">No file open</p>
          <p className="text-xs text-muted-foreground/60">Click a file in the explorer to edit it</p>
        </div>
      </div>
    );
  }

  const ext = getFileExt(openFilePath);

  if (IMAGE_EXTENSIONS.has(ext) && openFileProjectId) {
    return <ImagePreview path={openFilePath} projectId={openFileProjectId} />;
  }

  if (BINARY_EXTENSIONS.has(ext)) {
    return <UnsupportedFilePreview path={openFilePath} />;
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      {externallyChanged && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-sm shrink-0">
          <span className="text-xs text-destructive flex-1">File changed externally.</span>
          <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={acceptExternal}>
            Reload
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={dismissExternal}>
            Keep mine
          </Button>
        </div>
      )}
      <CodeEditor />
    </div>
  );
}
