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
      backgroundColor: `${nord.nord3}80`,
      outline: `1px solid ${nord.nord3}`,
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

const nordLightTheme = EditorView.theme(
  {
    "&": { backgroundColor: nord.nord6, color: nord.nord0 },
    ".cm-content": { caretColor: nord.nord0 },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: nord.nord0 },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
      { backgroundColor: `${nord.nord4}b0` },
    ".cm-panels": { backgroundColor: nord.nord5, color: nord.nord0 },
    ".cm-searchMatch": { backgroundColor: `${nord.nord13}40`, outline: `1px solid ${nord.nord13}80` },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: `${nord.nord13}60` },
    ".cm-activeLine": { backgroundColor: `${nord.nord5}80` },
    ".cm-selectionMatch": { backgroundColor: `${nord.nord4}60` },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
      backgroundColor: `${nord.nord4}80`,
      outline: `1px solid ${nord.nord4}`,
    },
    ".cm-gutters": { backgroundColor: nord.nord6, color: nord.nord3, borderRight: `1px solid ${nord.nord5}` },
    ".cm-activeLineGutter": { backgroundColor: `${nord.nord5}80` },
    ".cm-foldPlaceholder": { backgroundColor: nord.nord5, border: "none", color: nord.nord3 },
    ".cm-tooltip": { backgroundColor: nord.nord5, border: `1px solid ${nord.nord4}`, color: nord.nord0 },
    ".cm-tooltip-autocomplete": { "& > ul > li[aria-selected]": { backgroundColor: nord.nord4 } },
  },
  { dark: false }
);

const nordDarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: nord.nord9 },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: nord.nord4 },
  { tag: [tags.propertyName], color: nord.nord8 },
  { tag: [tags.function(tags.variableName), tags.labelName], color: nord.nord8 },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: nord.nord7 },
  { tag: [tags.definition(tags.name), tags.separator], color: nord.nord4 },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: nord.nord7 },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: nord.nord13 },
  { tag: [tags.meta, tags.comment], color: nord.nord3, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: nord.nord7, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: nord.nord8 },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: nord.nord15 },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: nord.nord14 },
  { tag: tags.invalid, color: nord.nord11 },
  { tag: tags.tagName, color: nord.nord9 },
  { tag: tags.attributeName, color: nord.nord7 },
  { tag: tags.attributeValue, color: nord.nord14 },
]);

const nordLightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: nord.nord9 },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: nord.nord0 },
  { tag: [tags.propertyName], color: nord.nord10 },
  { tag: [tags.function(tags.variableName), tags.labelName], color: nord.nord8 },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: nord.nord7 },
  { tag: [tags.definition(tags.name), tags.separator], color: nord.nord0 },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: nord.nord7 },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: nord.nord12 },
  { tag: [tags.meta, tags.comment], color: nord.nord3, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: nord.nord7, textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: nord.nord10 },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: nord.nord15 },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: nord.nord14 },
  { tag: tags.invalid, color: nord.nord11 },
  { tag: tags.tagName, color: nord.nord9 },
  { tag: tags.attributeName, color: nord.nord7 },
  { tag: tags.attributeValue, color: nord.nord14 },
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
          theme={resolvedTheme === "dark" ? "dark" : "light"}
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
