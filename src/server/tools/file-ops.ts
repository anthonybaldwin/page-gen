import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import type { FileNode } from "../../shared/types.ts";

function validateProjectPath(projectPath: string, filePath: string): string {
  const fullPath = join(projectPath, filePath);
  const resolved = join(process.cwd(), fullPath);
  const projectRoot = join(process.cwd(), projectPath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error("Path traversal denied: path escapes project directory");
  }
  return fullPath;
}

export function readFile(projectPath: string, filePath: string): string {
  const fullPath = validateProjectPath(projectPath, filePath);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return readFileSync(fullPath, "utf-8");
}

export function writeFile(projectPath: string, filePath: string, content: string): void {
  const fullPath = validateProjectPath(projectPath, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

export function deleteFile(projectPath: string, filePath: string): void {
  const fullPath = validateProjectPath(projectPath, filePath);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
}

export function listFiles(projectPath: string, subPath: string = ""): FileNode[] {
  const fullPath = join(projectPath, subPath);
  if (!existsSync(fullPath)) return [];

  const entries = readdirSync(fullPath, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .map((entry) => {
      const relPath = subPath ? `${subPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relPath,
          type: "directory" as const,
          children: listFiles(projectPath, relPath),
        };
      }
      return { name: entry.name, path: relPath, type: "file" as const };
    });
}

export function fileExists(projectPath: string, filePath: string): boolean {
  try {
    const fullPath = validateProjectPath(projectPath, filePath);
    return existsSync(fullPath);
  } catch {
    return false;
  }
}
