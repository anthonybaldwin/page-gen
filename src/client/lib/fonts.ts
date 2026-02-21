export interface FontEntry {
  name: string;
  family: string;
  category: "sans-serif" | "serif" | "monospace";
}

export interface CustomFontMeta {
  id: string;
  name: string;
  filename: string;
  category: "sans-serif" | "serif" | "monospace";
}

// --- System fonts (always available, no files needed) ---

export const SYSTEM_UI_FONTS: FontEntry[] = [
  { name: "System Default", family: "system-ui, -apple-system, sans-serif", category: "sans-serif" },
  { name: "Arial", family: "Arial, Helvetica, sans-serif", category: "sans-serif" },
  { name: "Verdana", family: "Verdana, Geneva, sans-serif", category: "sans-serif" },
  { name: "Georgia", family: "Georgia, 'Times New Roman', serif", category: "serif" },
  { name: "Segoe UI", family: "'Segoe UI', Tahoma, Geneva, sans-serif", category: "sans-serif" },
];

export const SYSTEM_EDITOR_FONTS: FontEntry[] = [
  { name: "System Default", family: "ui-monospace, 'SF Mono', 'Cascadia Code', 'Fira Code', monospace", category: "monospace" },
  { name: "Consolas", family: "Consolas, 'Courier New', monospace", category: "monospace" },
  { name: "Courier New", family: "'Courier New', Courier, monospace", category: "monospace" },
];

// --- Bundled fonts (shipped with the app as .woff2) ---

export const BUNDLED_UI_FONTS: FontEntry[] = [
  { name: "Inter", family: "'Inter', sans-serif", category: "sans-serif" },
  { name: "Open Sans", family: "'Open Sans', sans-serif", category: "sans-serif" },
  { name: "Roboto", family: "'Roboto', sans-serif", category: "sans-serif" },
  { name: "Lato", family: "'Lato', sans-serif", category: "sans-serif" },
  { name: "Nunito", family: "'Nunito', sans-serif", category: "sans-serif" },
  { name: "Source Sans 3", family: "'Source Sans 3', sans-serif", category: "sans-serif" },
  { name: "Merriweather", family: "'Merriweather', serif", category: "serif" },
];

export const BUNDLED_EDITOR_FONTS: FontEntry[] = [
  { name: "JetBrains Mono", family: "'JetBrains Mono', monospace", category: "monospace" },
  { name: "Fira Code", family: "'Fira Code', monospace", category: "monospace" },
  { name: "Source Code Pro", family: "'Source Code Pro', monospace", category: "monospace" },
  { name: "IBM Plex Mono", family: "'IBM Plex Mono', monospace", category: "monospace" },
];

// --- Custom font @font-face injection ---

const CUSTOM_STYLE_ID = "custom-font-faces";

export function injectCustomFontFaces(fonts: CustomFontMeta[]): void {
  let style = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;

  if (fonts.length === 0) {
    style?.remove();
    return;
  }

  if (!style) {
    style = document.createElement("style");
    style.id = CUSTOM_STYLE_ID;
    document.head.appendChild(style);
  }

  style.textContent = fonts
    .map(
      (f) => `@font-face {
  font-family: '${f.name}';
  src: url('/api/fonts/files/${f.id}') format('woff2');
  font-display: swap;
}`
    )
    .join("\n\n");
}

export function customFontToEntry(meta: CustomFontMeta): FontEntry {
  return {
    name: meta.name,
    family: `'${meta.name}', ${meta.category}`,
    category: meta.category,
  };
}
