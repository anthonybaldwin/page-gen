import { tool } from "ai";
import { z } from "zod";
import { writeFile, readFile, listFiles } from "../tools/file-ops.ts";
import { broadcastFilesChanged } from "../ws.ts";
import { log } from "../services/logger.ts";
import { autoCommit } from "../services/versioning.ts";
import { MAX_AGENT_VERSIONS_PER_RUN } from "../config/versioning.ts";

export function createAgentTools(projectPath: string, projectId: string) {
  const filesWritten: string[] = [];
  let versionCounter = 0;

  const tools = {
    write_file: tool({
      description: "Write or overwrite a file in the project.",
      inputSchema: z.object({
        path: z.string().describe("Relative path from project root"),
        content: z.string().describe("Complete file content"),
      }),
      execute: async ({ path, content }) => {
        log("tool", `write_file: ${path}`, { path, chars: content.length });
        writeFile(projectPath, path, content);
        broadcastFilesChanged(projectId, [path]);
        filesWritten.push(path);
        return { success: true, path };
      },
    }),
    write_files: tool({
      description: "Write multiple files at once. Preferred over write_file when creating or updating several files — saves steps and tokens.",
      inputSchema: z.object({
        files: z.array(z.object({
          path: z.string().describe("Relative path from project root"),
          content: z.string().describe("Complete file content"),
        })),
      }),
      execute: async ({ files }) => {
        log("tool", `write_files: ${files.length} files`, { paths: files.map(f => f.path) });
        const written: string[] = [];
        for (const f of files) {
          writeFile(projectPath, f.path, f.content);
          written.push(f.path);
        }
        broadcastFilesChanged(projectId, written);
        filesWritten.push(...written);
        return { success: true, paths: written };
      },
    }),
    read_file: tool({
      description: "Read an existing file's contents.",
      inputSchema: z.object({
        path: z.string().describe("Relative path from project root"),
      }),
      execute: async ({ path }) => {
        log("tool", `read_file: ${path}`, { path });
        try {
          return { content: readFile(projectPath, path) };
        } catch {
          return { error: "File not found" };
        }
      },
    }),
    list_files: tool({
      description: "List files and directories in the project.",
      inputSchema: z.object({
        directory: z.string().optional().describe("Subdirectory to list, omit for root"),
      }),
      execute: async ({ directory }) => {
        log("tool", `list_files: ${directory || "."}`, { path: directory || "." });
        return { files: listFiles(projectPath, directory) };
      },
    }),
    save_version: tool({
      description: "Save the current project state as a version checkpoint. Use sparingly — only before risky changes or after completing a major milestone. Do NOT call this after every small change.",
      inputSchema: z.object({
        label: z.string().describe("Short description of what this checkpoint captures (e.g. 'Scaffolding complete', 'Before refactor')"),
      }),
      execute: async ({ label }) => {
        if (versionCounter >= MAX_AGENT_VERSIONS_PER_RUN) {
          return { success: false, reason: "Version limit reached for this pipeline run" };
        }
        try {
          const sha = autoCommit(projectPath, label);
          if (!sha) return { success: true, note: "No changes to save" };
          versionCounter++;
          log("tool", `save_version: ${label}`, { sha: sha.slice(0, 7), versionCounter });
          return { success: true, sha: sha.slice(0, 7) };
        } catch (err) {
          log("tool", `save_version failed: ${err instanceof Error ? err.message : String(err)}`);
          return { success: false, reason: "Version save failed" };
        }
      },
    }),
  };

  return { tools, getFilesWritten: () => [...filesWritten] };
}
