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
import { Button } from "../ui/button.tsx";
import { Save, Loader2 } from "lucide-react";

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

// --- Dark mode: Nord Aurora (warm Aurora accents on Polar Night) ---
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
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: `${nord.nord13}70`,
      outline: `1px solid ${nord.nord13}`,
      color: nord.nord6,
    },
    "&.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: `${nord.nord11}70`,
      outline: `1px solid ${nord.nord11}`,
      color: nord.nord6,
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

// --- Light mode: Nord Light Brighter (white bg, high-contrast syntax) ---
// Colors sourced from https://github.com/huytd/vscode-nord-light
const nordLightTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#ffffff", color: "#24292e" },
    ".cm-content": { caretColor: "#24292e" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#24292e" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: "#d7dce3" },
    ".cm-panels": { backgroundColor: "#f6f8fa", color: "#24292e" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid #e1e4e8" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid #e1e4e8" },
    ".cm-searchMatch": { backgroundColor: "#fff8c5", outline: "1px solid #e8d44d" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#ffe58f" },
    ".cm-activeLine": { backgroundColor: "#f6f8fa" },
    ".cm-selectionMatch": { backgroundColor: "#e1e8f0" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "#a0c4e8",
      outline: "1px solid #5a9fd4",
      color: "#003d7a",
    },
    "&.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: "#f5b3b9",
      outline: "1px solid #c9374a",
      color: "#9e1a2a",
    },
    ".cm-gutters": { backgroundColor: "#ffffff", color: "#959da5", borderRight: "1px solid #e1e4e8" },
    ".cm-activeLineGutter": { backgroundColor: "#f6f8fa" },
    ".cm-foldPlaceholder": { backgroundColor: "#f1f8ff", border: "none", color: "#586069" },
    ".cm-tooltip": { backgroundColor: "#f6f8fa", border: "1px solid #e1e4e8", color: "#24292e" },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "#e1e4e8", borderBottomColor: "#e1e4e8" },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "#f6f8fa", borderBottomColor: "#f6f8fa" },
    ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: "#e1e4e8" } },
  },
  { dark: false }
);

// --- Dark syntax: Aurora-themed (warm reds, oranges, greens, purples) ---
const nordDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: nord.nord11 },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: nord.nord4 },
  { tag: [tags.propertyName], color: nord.nord8 },
  { tag: [tags.function(tags.variableName), tags.labelName], color: nord.nord12 },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: nord.nord15 },
  { tag: [tags.definition(tags.name), tags.separator], color: nord.nord4 },
  { tag: [tags.typeName, tags.className, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: nord.nord7 },
  { tag: tags.number, color: nord.nord15 },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: nord.nord13 },
  { tag: [tags.meta, tags.comment], color: nord.nord3, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: nord.nord8, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: nord.nord12 },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: nord.nord15 },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: nord.nord14 },
  { tag: tags.invalid, color: nord.nord11 },
  { tag: tags.tagName, color: nord.nord11 },
  { tag: tags.attributeName, color: nord.nord12 },
  { tag: tags.attributeValue, color: nord.nord14 },
]);

// --- Light syntax: Nord Light Brighter (high-contrast on white) ---
const nordLightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#2F6F9F" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: "#24292e" },
  { tag: [tags.propertyName], color: "#005CC5" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#5724BB" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#7653C1" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#24292e" },
  { tag: [tags.typeName, tags.className, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#D44950" },
  { tag: tags.number, color: "#A74047" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "#CB5C69" },
  { tag: [tags.meta, tags.comment], color: "#8995A0", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#032F62", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "#005CC5" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#7653C1" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#50750E" },
  { tag: tags.invalid, color: "#B31D28" },
  { tag: tags.tagName, color: "#2F6F9F" },
  { tag: tags.attributeName, color: "#0D7579" },
  { tag: tags.attributeValue, color: "#50750E" },
]);

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

  const handleSave = useCallback(() => {
    saveFile();
  }, [saveFile]);

  const extensions = useMemo(() => {
    const lang = openFilePath ? getLanguageExtension(openFilePath) : [];
    const isDark = resolvedTheme === "dark";
    return [
      keymap.of([{ key: "Mod-s", run: () => { handleSave(); return true; } }]),
      isDark ? nordDarkTheme : nordLightTheme,
      syntaxHighlighting(isDark ? nordDarkHighlight : nordLightHighlight),
      EditorView.lineWrapping,
      ...(Array.isArray(lang) ? lang : [lang]),
    ];
  }, [openFilePath, resolvedTheme, handleSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <span className="text-xs text-muted-foreground truncate flex-1">
          {openFilePath}
          {isDirty && <span className="text-primary ml-1">*</span>}
        </span>
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

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={currentContent}
          onChange={updateContent}
          extensions={extensions}
          theme="none"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            tabSize: 2,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            autocompletion: true,
          }}
          className="h-full"
          height="100%"
        />
      </div>
    </div>
  );
}
