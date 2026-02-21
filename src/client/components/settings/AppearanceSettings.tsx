import { useState, useRef } from "react";
import { useAppearanceStore } from "../../stores/appearanceStore.ts";
import { api } from "../../lib/api.ts";
import { apiUpload } from "../../lib/api.ts";
import {
  SYSTEM_UI_FONTS,
  SYSTEM_EDITOR_FONTS,
  BUNDLED_UI_FONTS,
  BUNDLED_EDITOR_FONTS,
  customFontToEntry,
  type FontEntry,
  type CustomFontMeta,
} from "../../lib/fonts.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Loader2, Upload, Trash2 } from "lucide-react";

function FontSelector({
  label,
  description,
  value,
  onChange,
  systemFonts,
  bundledFonts,
  customFonts,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (font: FontEntry) => void;
  systemFonts: FontEntry[];
  bundledFonts: FontEntry[];
  customFonts: FontEntry[];
}) {
  const allFonts = [...systemFonts, ...bundledFonts, ...customFonts];

  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
      <p className="text-[11px] text-muted-foreground/70 mb-2">{description}</p>
      <Select
        value={value}
        onValueChange={(name) => {
          const font = allFonts.find((f) => f.name === name);
          if (font) onChange(font);
        }}
      >
        <SelectTrigger className="w-full text-sm" style={{ fontFamily: allFonts.find((f) => f.name === value)?.family }}>
          <SelectValue placeholder="Select a font" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">System</SelectLabel>
            {systemFonts.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                <span style={{ fontFamily: f.family }}>{f.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Bundled</SelectLabel>
            {bundledFonts.map((f) => (
              <SelectItem key={f.name} value={f.name}>
                <span style={{ fontFamily: f.family }}>{f.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
          {customFonts.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Custom</SelectLabel>
              {customFonts.map((f) => (
                <SelectItem key={f.name} value={f.name}>
                  <span style={{ fontFamily: f.family }}>{f.name}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AppearanceSettings() {
  const { uiFont, editorFont, customFonts, setUiFont, setEditorFont, removeCustomFont, addCustomFont } =
    useAppearanceStore();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fontName, setFontName] = useState("");
  const [fontCategory, setFontCategory] = useState<"sans-serif" | "serif" | "monospace">("sans-serif");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customUIFonts = customFonts
    .filter((f) => f.category !== "monospace")
    .map(customFontToEntry);
  const customEditorFonts = customFonts
    .filter((f) => f.category === "monospace")
    .map(customFontToEntry);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadError(null);
    // Auto-fill name from filename (strip extension)
    const baseName = file.name.replace(/\.(ttf|otf|woff2?|woff)$/i, "");
    setFontName(baseName);
  }

  async function handleUpload() {
    if (!selectedFile || !fontName.trim()) return;

    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("name", fontName.trim());
      formData.append("category", fontCategory);

      const meta = await apiUpload<CustomFontMeta>("/fonts/upload", formData);
      addCustomFont(meta);

      // Reset form
      setSelectedFile(null);
      setFontName("");
      setFontCategory("sans-serif");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api.delete(`/fonts/${id}`);
      removeCustomFont(id);
    } catch {
      // Non-fatal
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Font selectors */}
      <div>
        <h3 className="text-sm font-medium mb-1">Fonts</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Customize the fonts used in the interface and code editor. Changes apply immediately.
        </p>
      </div>

      <div className="space-y-4">
        <FontSelector
          label="Interface Font"
          description="Used for all UI text — sidebar, chat, tabs, menus."
          value={uiFont.name}
          onChange={(f) => setUiFont({ name: f.name, family: f.family })}
          systemFonts={SYSTEM_UI_FONTS}
          bundledFonts={BUNDLED_UI_FONTS}
          customFonts={customUIFonts}
        />

        <FontSelector
          label="Editor Font"
          description="Used for the CodeMirror code editor."
          value={editorFont.name}
          onChange={(f) => setEditorFont({ name: f.name, family: f.family })}
          systemFonts={SYSTEM_EDITOR_FONTS}
          bundledFonts={BUNDLED_EDITOR_FONTS}
          customFonts={customEditorFonts}
        />
      </div>

      {/* Upload custom font */}
      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-medium mb-1">Custom Fonts</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Upload your own font files (.ttf, .otf, .woff, .woff2). Max 5MB each.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              Choose File
            </Button>
            {selectedFile && (
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                {selectedFile.name}
              </span>
            )}
          </div>

          {selectedFile && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Font Name</label>
                <Input
                  value={fontName}
                  onChange={(e) => setFontName(e.target.value)}
                  placeholder="My Custom Font"
                  className="text-sm h-8"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <Select value={fontCategory} onValueChange={(v) => setFontCategory(v as typeof fontCategory)}>
                  <SelectTrigger className="text-sm h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sans-serif">Sans-serif</SelectItem>
                    <SelectItem value="serif">Serif</SelectItem>
                    <SelectItem value="monospace">Monospace</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                className="text-xs h-8"
                onClick={handleUpload}
                disabled={uploading || !fontName.trim()}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Upload"}
              </Button>
            </div>
          )}

          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}
        </div>
      </div>

      {/* Custom fonts list */}
      {customFonts.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Uploaded Fonts</h4>
          {customFonts.map((font) => (
            <div
              key={font.id}
              className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm truncate" style={{ fontFamily: `'${font.name}', ${font.category}` }}>
                  {font.name}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {font.category}
                </span>
                <span className="text-[10px] text-muted-foreground/60 truncate">
                  {font.filename}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => handleDelete(font.id)}
                disabled={deleting === font.id}
              >
                {deleting === font.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
