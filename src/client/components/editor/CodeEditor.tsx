import { useCallback, useMemo } from "react";
import CodeMirror, { keymap, EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { getNordExtensions } from "../../lib/nordTheme.ts";
import { useThemeStore } from "../../stores/themeStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { useVersionStore } from "../../stores/versionStore.ts";
import { useAppearanceStore } from "../../stores/appearanceStore.ts";
import { Button } from "../ui/button.tsx";
import { Save, Loader2, Lock } from "lucide-react";

function getLanguageExtension(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "js":
    case "jsx":
      return javascript({ jsx: true });
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "md":
    case "mdx":
      return markdown();
    default:
      return [];
  }
}

export function CodeEditor() {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const { openFilePath, currentContent, isDirty, isSaving, saveFile, updateContent } = useFileStore();
  const isPreviewing = useVersionStore((s) => s.isPreviewing);
  const editorItalicFont = useAppearanceStore((s) => s.editorItalicFont);

  const handleSave = useCallback(() => {
    if (isPreviewing) return;
    saveFile();
  }, [saveFile, isPreviewing]);

  const extensions = useMemo(() => {
    const lang = openFilePath ? getLanguageExtension(openFilePath) : [];
    const isDark = resolvedTheme === "dark";
    const exts = [
      ...getNordExtensions(isDark, editorItalicFont.family),
      EditorView.lineWrapping,
      ...(Array.isArray(lang) ? lang : [lang]),
    ];
    if (!isPreviewing) {
      exts.unshift(keymap.of([{ key: "Mod-s", run: () => { handleSave(); return true; } }]));
    }
    if (isPreviewing) {
      exts.push(EditorView.editable.of(false));
      exts.push(EditorView.theme({ ".cm-content, .cm-line": { cursor: "not-allowed" } }));
    }
    return exts;
  }, [openFilePath, resolvedTheme, handleSave, isPreviewing, editorItalicFont]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Address bar — matches preview panel style */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {openFilePath}
          {isPreviewing && (
            <span className="text-amber-600 dark:text-amber-400 ml-1.5 inline-flex items-center gap-0.5">
              <Lock className="h-2.5 w-2.5 inline" />
              read-only
            </span>
          )}
          {!isPreviewing && isDirty && <span className="text-primary ml-1">*</span>}
        </span>
        {!isPreviewing && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 gap-1"
              onClick={handleSave}
              disabled={!isDirty || isSaving}
            >
              {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              <span className="text-xs">Save</span>
            </Button>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={currentContent}
          onChange={isPreviewing ? undefined : updateContent}
          extensions={extensions}
          readOnly={isPreviewing}
          theme="none"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: !isPreviewing,
            indentOnInput: !isPreviewing,
            tabSize: 2,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            autocompletion: !isPreviewing,
          }}
          className="h-full"
          height="100%"
        />
      </div>
    </div>
  );
}
