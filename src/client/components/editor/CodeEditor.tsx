import { useCallback, useMemo } from "react";
import CodeMirror, { keymap, EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { useThemeStore } from "../../stores/themeStore.ts";
import { useFileStore } from "../../stores/fileStore.ts";
import { useVersionStore } from "../../stores/versionStore.ts";
import { useAppearanceStore } from "../../stores/appearanceStore.ts";
import { Button } from "../ui/button.tsx";
import { Save, Loader2, Lock } from "lucide-react";

// Nord palette
const nord = {
  // Polar Night
  nord0: "#2e3440",
  nord1: "#3b4252",
  nord2: "#434c5e",
  nord3: "#4c566a",
  // Snow Storm
  nord4: "#d8dee9",
  nord5: "#e5e9f0",
  nord6: "#eceff4",
  // Frost
  nord7: "#8fbcbb",
  nord8: "#88c0d0",
  nord9: "#81a1c1",
  nord10: "#5e81ac",
  // Aurora
  nord11: "#bf616a",
  nord12: "#d08770",
  nord13: "#ebcb8b",
  nord14: "#a3be8c",
  nord15: "#b48ead",
};

// --- Dark editor chrome (Polar Night background) ---
const nordDarkTheme = EditorView.theme(
  {
    "&": { backgroundColor: nord.nord0, color: nord.nord4 },
    ".cm-content": { caretColor: nord.nord4 },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: nord.nord4 },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: nord.nord2 },
    ".cm-panels": { backgroundColor: nord.nord1, color: nord.nord4 },
    ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${nord.nord3}` },
    ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${nord.nord3}` },
    ".cm-searchMatch": { backgroundColor: `${nord.nord13}40`, outline: `1px solid ${nord.nord13}60` },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: `${nord.nord13}60` },
    ".cm-activeLine": { backgroundColor: `${nord.nord1}80` },
    ".cm-selectionMatch": { backgroundColor: `${nord.nord2}80` },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: nord.nord3,
      outline: `1px solid ${nord.nord9}`,
    },
    ".cm-gutters": { backgroundColor: nord.nord0, color: nord.nord3, borderRight: `1px solid ${nord.nord1}` },
    ".cm-activeLineGutter": { backgroundColor: `${nord.nord1}80` },
    ".cm-foldPlaceholder": { backgroundColor: nord.nord2, border: "none", color: nord.nord4 },
    ".cm-tooltip": { backgroundColor: nord.nord1, border: `1px solid ${nord.nord3}`, color: nord.nord4 },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: nord.nord3, borderBottomColor: nord.nord3 },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: nord.nord1, borderBottomColor: nord.nord1 },
    ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: nord.nord2 } },
  },
  { dark: true }
);

// --- Light editor chrome (Snow Storm background) ---
const nordLightTheme = EditorView.theme(
  {
    "&": { backgroundColor: nord.nord6, color: nord.nord0 },
    ".cm-content": { caretColor: nord.nord0 },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: nord.nord0 },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: nord.nord4 },
    ".cm-panels": { backgroundColor: nord.nord5, color: nord.nord0 },
    ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${nord.nord4}` },
    ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${nord.nord4}` },
    ".cm-searchMatch": { backgroundColor: `${nord.nord13}40`, outline: `1px solid ${nord.nord13}60` },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: `${nord.nord13}60` },
    ".cm-activeLine": { backgroundColor: `${nord.nord5}80` },
    ".cm-selectionMatch": { backgroundColor: `${nord.nord4}80` },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: nord.nord4,
      outline: `1px solid ${nord.nord10}`,
    },
    ".cm-gutters": { backgroundColor: nord.nord6, color: nord.nord3, borderRight: `1px solid ${nord.nord5}` },
    ".cm-activeLineGutter": { backgroundColor: `${nord.nord5}80` },
    ".cm-foldPlaceholder": { backgroundColor: nord.nord5, border: "none", color: nord.nord3 },
    ".cm-tooltip": { backgroundColor: nord.nord5, border: `1px solid ${nord.nord4}`, color: nord.nord0 },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: nord.nord4, borderBottomColor: nord.nord4 },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: nord.nord5, borderBottomColor: nord.nord5 },
    ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: nord.nord4 } },
  },
  { dark: false }
);

// --- Shared syntax highlighting (same colors in both modes) ---
// Frost (nord7–10) for structural tokens, Aurora (nord11–15) for values/literals
function createNordHighlight(italicFontFamily?: string) {
  return HighlightStyle.define([
    { tag: tags.keyword, color: nord.nord9 },
    { tag: [tags.propertyName], color: nord.nord8 },
    { tag: [tags.function(tags.variableName), tags.labelName], color: nord.nord8 },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: nord.nord9 },
    { tag: [tags.typeName, tags.className, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: nord.nord7 },
    { tag: tags.number, color: nord.nord15 },
    { tag: [tags.operator, tags.operatorKeyword], color: nord.nord9 },
    { tag: [tags.url, tags.escape, tags.regexp, tags.special(tags.string)], color: nord.nord13 },
    { tag: [tags.meta, tags.comment], color: nord.nord3, fontStyle: "italic", ...(italicFontFamily ? { fontFamily: italicFontFamily } : {}) },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic", ...(italicFontFamily ? { fontFamily: italicFontFamily } : {}) },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.link, color: nord.nord8, textDecoration: "underline" },
    { tag: tags.heading, fontWeight: "bold", color: nord.nord8 },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: nord.nord9 },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: nord.nord14 },
    { tag: tags.invalid, color: nord.nord11 },
    { tag: tags.tagName, color: nord.nord9 },
    { tag: tags.attributeName, color: nord.nord7 },
    { tag: tags.attributeValue, color: nord.nord14 },
  ]);
}

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
    const nordHighlight = createNordHighlight(editorItalicFont.family);
    const exts = [
      isDark ? nordDarkTheme : nordLightTheme,
      syntaxHighlighting(nordHighlight),
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
