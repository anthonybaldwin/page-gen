import { tool } from "ai";
import { z } from "zod";
import { writeFile, readFile, listFiles } from "../tools/file-ops.ts";
import { broadcastFilesChanged } from "../ws.ts";
import { log } from "../services/logger.ts";

export function createAgentTools(projectPath: string, projectId: string) {
  const filesWritten: string[] = [];

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
  };

  return { tools, getFilesWritten: () => [...filesWritten] };
}
