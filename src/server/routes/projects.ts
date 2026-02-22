import { Hono } from "hono";
import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mkdirSync, rmSync, existsSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { abortOrchestration } from "../agents/orchestrator.ts";
import { stopPreviewServer } from "../preview/vite-server.ts";
import { stopBackendServer } from "../preview/backend-server.ts";
import { log } from "../services/logger.ts";
import { ensureGitRepo } from "../services/versioning.ts";
import type { VibeBrief } from "../../shared/types.ts";

export const projectRoutes = new Hono();

/** Parse vibeBrief JSON from DB row into typed object. */
function parseProject(row: typeof schema.projects.$inferSelect) {
  return {
    ...row,
    vibeBrief: row.vibeBrief ? JSON.parse(row.vibeBrief) as VibeBrief : null,
  };
}

// List all projects
projectRoutes.get("/", async (c) => {
  const allProjects = await db.select().from(schema.projects).all();
  return c.json(allProjects.map(parseProject));
});

// Get single project
projectRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(parseProject(project));
});

// Create project
projectRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name: string }>();
  const id = nanoid();
  const projectPath = `./projects/${id}`;
  const now = Date.now();

  mkdirSync(`${projectPath}/src`, { recursive: true });
  ensureGitRepo(projectPath);

  const project = {
    id,
    name: body.name,
    path: projectPath,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.projects).values(project);
  log("project", `Created project "${body.name}"`, { projectId: id });
  return c.json(project, 201);
});

// Update project (name and/or vibeBrief)
projectRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; vibeBrief?: VibeBrief | null }>();
  const now = Date.now();

  const setFields: Record<string, unknown> = { updatedAt: now };
  if (body.name !== undefined) setFields.name = body.name;
  if (body.vibeBrief !== undefined) {
    setFields.vibeBrief = body.vibeBrief ? JSON.stringify(body.vibeBrief) : null;
  }

  const updated = await db
    .update(schema.projects)
    .set(setFields)
    .where(eq(schema.projects.id, id))
    .returning()
    .get();
  if (!updated) return c.json({ error: "Project not found" }, 404);
  if (body.name) log("project", `Renamed project ${id} to "${body.name}"`);
  if (body.vibeBrief !== undefined) log("project", `Updated vibe brief for project ${id}`);
  return c.json(parseProject(updated));
});

// Delete project (cascade: all chats + children, disk cleanup)
projectRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  // Fetch all chats for this project
  const projectChats = await db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(eq(schema.chats.projectId, id))
    .all();

  // Abort any active orchestrations and delete children for each chat
  for (const chat of projectChats) {
    abortOrchestration(chat.id);
    await db.delete(schema.tokenUsage).where(eq(schema.tokenUsage.chatId, chat.id));
    await db.delete(schema.pipelineRuns).where(eq(schema.pipelineRuns.chatId, chat.id));
    await db.delete(schema.agentExecutions).where(eq(schema.agentExecutions.chatId, chat.id));
    await db.delete(schema.messages).where(eq(schema.messages.chatId, chat.id));
  }

  // Delete chats, then project
  await db.delete(schema.chats).where(eq(schema.chats.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id));

  // Stop any running servers, then remove project directory from disk
  await stopBackendServer(id);
  await stopPreviewServer(id);
  try {
    rmSync(resolve("projects", id), { recursive: true, force: true });
  } catch {
    // Directory may not exist — safe to ignore
  }

  log("project", `Deleted project ${id}`, { chats: projectChats.length });
  return c.json({ ok: true });
});

// --- Mood board image endpoints ---

const MOOD_DIR = "mood";
const MAX_MOOD_IMAGES = 10;
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function getMoodDir(projectPath: string): string {
  return join(projectPath, MOOD_DIR);
}

// Upload mood images (multipart form data)
projectRoutes.post("/:id/mood-images", async (c) => {
  const id = c.req.param("id");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const moodDir = getMoodDir(project.path);
  mkdirSync(moodDir, { recursive: true });

  // Count existing images
  const existing = existsSync(moodDir) ? readdirSync(moodDir) : [];
  if (existing.length >= MAX_MOOD_IMAGES) {
    return c.json({ error: `Maximum ${MAX_MOOD_IMAGES} mood images allowed` }, 400);
  }

  const formData = await c.req.formData();
  const uploaded: string[] = [];

  for (const [, value] of formData.entries()) {
    if (typeof value === "string" || !("name" in (value as object))) continue;
    const file = value as unknown as { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    if (existing.length + uploaded.length >= MAX_MOOD_IMAGES) break;

    const filename = `${nanoid(8)}${ext}`;
    const buffer = await file.arrayBuffer();
    writeFileSync(join(moodDir, filename), Buffer.from(buffer));
    uploaded.push(filename);
  }

  log("project", `Uploaded ${uploaded.length} mood image(s) for project ${id}`);
  return c.json({ uploaded });
});

// List mood images
projectRoutes.get("/:id/mood-images", async (c) => {
  const id = c.req.param("id");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const moodDir = getMoodDir(project.path);
  const files = existsSync(moodDir) ? readdirSync(moodDir) : [];
  return c.json({ images: files });
});

// Serve a mood image file
projectRoutes.get("/:id/mood-images/:filename/file", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const filePath = join(getMoodDir(project.path), filename);
  if (!existsSync(filePath)) return c.json({ error: "Image not found" }, 404);

  const ext = filename.substring(filename.lastIndexOf(".") + 1).toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  const buffer = readFileSync(filePath);
  return new Response(buffer, { headers: { "Content-Type": mimeType, "Cache-Control": "public, max-age=86400" } });
});

// Delete a mood image
projectRoutes.delete("/:id/mood-images/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!project) return c.json({ error: "Project not found" }, 404);

  const filePath = join(getMoodDir(project.path), filename);
  if (!existsSync(filePath)) return c.json({ error: "Image not found" }, 404);
  unlinkSync(filePath);
  log("project", `Deleted mood image ${filename} from project ${id}`);
  return c.json({ ok: true });
});
