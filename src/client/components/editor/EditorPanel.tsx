import { useFileStore } from "../../stores/fileStore.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { Button } from "../ui/button.tsx";
import { Loader2, FileCode } from "lucide-react";

export function EditorPanel() {
  const { openFilePath, isLoading, externallyChanged, acceptExternal, dismissExternal } = useFileStore();

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
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
