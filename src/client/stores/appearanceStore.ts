import { create } from "zustand";
import { api } from "../lib/api.ts";
import {
  SYSTEM_UI_FONTS,
  SYSTEM_EDITOR_FONTS,
  injectCustomFontFaces,
  type CustomFontMeta,
} from "../lib/fonts.ts";

interface FontSelection {
  name: string;
  family: string;
}

interface AppearanceState {
  uiFont: FontSelection;
  editorFont: FontSelection;
  editorItalicFont: FontSelection;
  customFonts: CustomFontMeta[];
  setUiFont: (font: FontSelection) => void;
  setEditorFont: (font: FontSelection) => void;
  setEditorItalicFont: (font: FontSelection) => void;
  loadCustomFonts: () => Promise<void>;
  removeCustomFont: (id: string) => void;
  addCustomFont: (meta: CustomFontMeta) => void;
}

const DEFAULT_UI_FONT: FontSelection = {
  name: SYSTEM_UI_FONTS[0]!.name,
  family: SYSTEM_UI_FONTS[0]!.family,
};

const DEFAULT_EDITOR_FONT: FontSelection = {
  name: SYSTEM_EDITOR_FONTS[0]!.name,
  family: SYSTEM_EDITOR_FONTS[0]!.family,
};

function applyFontVars(uiFamily: string, editorFamily: string) {
  const root = document.documentElement.style;
  root.setProperty("--font-ui", uiFamily);
  root.setProperty("--font-editor", editorFamily);
}

function loadFontPref(key: string): FontSelection | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === "string" && typeof parsed.family === "string") {
      return parsed as FontSelection;
    }
  } catch { /* ignore */ }
  return null;
}

function saveFontPref(key: string, font: FontSelection) {
  localStorage.setItem(key, JSON.stringify(font));
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  uiFont: DEFAULT_UI_FONT,
  editorFont: DEFAULT_EDITOR_FONT,
  editorItalicFont: DEFAULT_EDITOR_FONT,
  customFonts: [],

  setUiFont(font: FontSelection) {
    saveFontPref("font-ui", font);
    applyFontVars(font.family, get().editorFont.family);
    set({ uiFont: font });
  },

  setEditorFont(font: FontSelection) {
    saveFontPref("font-editor", font);
    applyFontVars(get().uiFont.family, font.family);
    set({ editorFont: font });
  },

  setEditorItalicFont(font: FontSelection) {
    saveFontPref("font-editor-italic", font);
    set({ editorItalicFont: font });
  },

  async loadCustomFonts() {
    try {
      const fonts = await api.get<CustomFontMeta[]>("/fonts");
      injectCustomFontFaces(fonts);
      set({ customFonts: fonts });
    } catch {
      // Non-fatal — custom fonts just won't be available
    }
  },

  removeCustomFont(id: string) {
    const updated = get().customFonts.filter((f) => f.id !== id);
    injectCustomFontFaces(updated);
    set({ customFonts: updated });

    // If the deleted font was active, reset to default
    const { uiFont, editorFont, editorItalicFont } = get();
    const deleted = get().customFonts.find((f) => f.id === id) ?? null;
    // Note: customFonts was already updated, so use the result from filter above
    if (deleted && uiFont.name === deleted.name) {
      get().setUiFont(DEFAULT_UI_FONT);
    }
    if (deleted && editorFont.name === deleted.name) {
      get().setEditorFont(DEFAULT_EDITOR_FONT);
    }
    if (deleted && editorItalicFont.name === deleted.name) {
      get().setEditorItalicFont(DEFAULT_EDITOR_FONT);
    }
  },

  addCustomFont(meta: CustomFontMeta) {
    const updated = [...get().customFonts, meta];
    injectCustomFontFaces(updated);
    set({ customFonts: updated });
  },
}));

/** Call once at app startup (before React renders). */
export function initAppearance() {
  const store = useAppearanceStore.getState();

  const uiFont = loadFontPref("font-ui") ?? DEFAULT_UI_FONT;
  const editorFont = loadFontPref("font-editor") ?? DEFAULT_EDITOR_FONT;
  const editorItalicFont = loadFontPref("font-editor-italic") ?? editorFont;

  applyFontVars(uiFont.family, editorFont.family);
  useAppearanceStore.setState({ uiFont, editorFont, editorItalicFont });

  // Load custom fonts in background
  store.loadCustomFonts();
}
