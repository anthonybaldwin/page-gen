import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";
import { log, logWarn } from "../services/logger.ts";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const FONTS_DIR = process.env.FONTS_DIR || "./data/fonts";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const CONTENT_TYPES: Record<string, string> = {
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Ensure fonts directory exists
mkdirSync(FONTS_DIR, { recursive: true });

export const fontRoutes = new Hono();

interface FontMeta {
  id: string;
  name: string;
  filename: string;
  category: string;
}

function parseFontMeta(value: string): FontMeta | null {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.id === "string") return parsed as FontMeta;
  } catch { /* ignore */ }
  return null;
}

// List all custom fonts
fontRoutes.get("/", (c) => {
  const rows = db
    .select()
    .from(schema.appSettings)
    .where(like(schema.appSettings.key, "font.custom.%"))
    .all();

  const fonts = rows
    .map((r) => parseFontMeta(r.value))
    .filter((f): f is FontMeta => f !== null);

  return c.json(fonts);
});

// Upload a custom font
fontRoutes.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  const name = body["name"];
  const category = body["category"];

  if (!(file instanceof File)) {
    return c.json({ error: "No file provided" }, 400);
  }
  if (typeof name !== "string" || !name.trim()) {
    return c.json({ error: "Font name is required" }, 400);
  }
  if (typeof category !== "string" || !["sans-serif", "serif", "monospace"].includes(category)) {
    return c.json({ error: "Category must be sans-serif, serif, or monospace" }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 5MB)" }, 400);
  }

  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({ error: `Invalid file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}` }, 400);
  }

  const id = randomUUID();
  const storedFilename = `${id}${ext}`;
  const filePath = join(FONTS_DIR, storedFilename);

  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);

  const meta: FontMeta = {
    id,
    name: name.trim(),
    filename: file.name,
    category,
  };

  const key = `font.custom.${id}`;
  db.insert(schema.appSettings)
    .values({ key, value: JSON.stringify(meta) })
    .run();

  log("fonts", `Custom font uploaded: ${meta.name}`, { id, filename: file.name, category });
  return c.json(meta, 201);
});

// Delete a custom font
fontRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const key = `font.custom.${id}`;

  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (!row) {
    return c.json({ error: "Font not found" }, 404);
  }

  // Delete metadata from DB
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();

  // Delete file from disk (try all possible extensions)
  for (const ext of ALLOWED_EXTENSIONS) {
    const filePath = join(FONTS_DIR, `${id}${ext}`);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
      } catch {
        logWarn("fonts", `Failed to delete font file: ${filePath}`);
      }
      break;
    }
  }

  log("fonts", `Custom font deleted: ${id}`);
  return c.json({ ok: true });
});

// Serve a font file
fontRoutes.get("/files/:id", async (c) => {
  const id = c.req.param("id");

  // Sanitize ID to prevent path traversal
  if (!/^[a-f0-9-]+$/i.test(id)) {
    return c.json({ error: "Invalid font ID" }, 400);
  }

  // Find the file with any allowed extension
  for (const ext of ALLOWED_EXTENSIONS) {
    const filePath = join(FONTS_DIR, `${id}${ext}`);
    if (existsSync(filePath)) {
      const file = Bun.file(filePath);
      const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
      return new Response(file.stream(), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  }

  return c.json({ error: "Font file not found" }, 404);
});
