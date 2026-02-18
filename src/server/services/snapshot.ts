import { db, schema } from "../db/index.ts";
import { eq, desc, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { join, dirname } from "path";

const MAX_SNAPSHOTS = 10;

function walkFiles(dir: string, basePath: string = ""): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(files, walkFiles(fullPath, relPath));
    } else {
      try {
        files[relPath] = readFileSync(fullPath, "utf-8");
      } catch {
        // skip binary/unreadable files
      }
    }
  }
  return files;
}

export function createSnapshot(
  projectId: string,
  projectPath: string,
  label: string,
  chatId?: string
): { id: string } {
  const fileManifest = walkFiles(projectPath);

  const snapshot = {
    id: nanoid(),
    projectId,
    chatId: chatId || null,
    label,
    fileManifest: JSON.stringify(fileManifest),
    createdAt: Date.now(),
  };

  db.insert(schema.snapshots).values(snapshot).run();

  // Prune old snapshots
  pruneSnapshots(projectId);

  return { id: snapshot.id };
}

export function rollbackSnapshot(snapshotId: string, projectPath: string): boolean {
  const snapshot = db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.id, snapshotId))
    .get();

  if (!snapshot) return false;

  const manifest = JSON.parse(snapshot.fileManifest) as Record<string, string>;

  // Clear existing files (but keep node_modules and dotfiles)
  clearProjectFiles(projectPath);

  // Restore all files from manifest
  for (const [filePath, content] of Object.entries(manifest)) {
    const fullPath = join(projectPath, filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  return true;
}

function clearProjectFiles(projectPath: string) {
  if (!existsSync(projectPath)) return;

  const entries = readdirSync(projectPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(projectPath, entry.name);
    rmSync(fullPath, { recursive: true, force: true });
  }
}

export function pruneSnapshots(projectId: string) {
  const snapshots = db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.projectId, projectId))
    .orderBy(desc(schema.snapshots.createdAt))
    .all();

  if (snapshots.length <= MAX_SNAPSHOTS) return;

  // Delete oldest snapshots beyond the limit
  const toDelete = snapshots.slice(MAX_SNAPSHOTS);
  for (const snap of toDelete) {
    db.delete(schema.snapshots).where(eq(schema.snapshots.id, snap.id)).run();
  }
}

export function listSnapshots(projectId: string) {
  return db
    .select({
      id: schema.snapshots.id,
      projectId: schema.snapshots.projectId,
      chatId: schema.snapshots.chatId,
      label: schema.snapshots.label,
      createdAt: schema.snapshots.createdAt,
    })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.projectId, projectId))
    .orderBy(desc(schema.snapshots.createdAt))
    .all();
}

export function getSnapshot(id: string) {
  return db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.id, id))
    .get();
}
