import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

interface SearchResult {
  file: string;
  line: number;
  content: string;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".css", ".html",
  ".yml", ".yaml", ".toml", ".txt", ".env", ".sh", ".sql",
]);

function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function walkDir(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, files);
    } else if (isTextFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

export function grepProject(projectPath: string, pattern: string, maxResults: number = 50): SearchResult[] {
  const results: SearchResult[] = [];
  const regex = new RegExp(pattern, "gi");
  const files = walkDir(projectPath);

  for (const file of files) {
    if (results.length >= maxResults) break;
    try {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          results.push({
            file: file.replace(projectPath + "/", "").replace(projectPath + "\\", ""),
            line: i + 1,
            content: lines[i]!.trim(),
          });
          if (results.length >= maxResults) break;
        }
        regex.lastIndex = 0;
      }
    } catch {
      // skip unreadable files
    }
  }
  return results;
}

export function findFiles(projectPath: string, pattern: string): string[] {
  const regex = new RegExp(pattern, "gi");
  const files = walkDir(projectPath);
  return files
    .map((f) => f.replace(projectPath + "/", "").replace(projectPath + "\\", ""))
    .filter((f) => regex.test(f));
}
