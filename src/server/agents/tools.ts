import { tool } from "ai";
import { z } from "zod";
import { writeFile, readFile, listFiles } from "../tools/file-ops.ts";
import { broadcastFilesChanged } from "../ws.ts";

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
        writeFile(projectPath, path, content);
        broadcastFilesChanged(projectId, [path]);
        filesWritten.push(path);
        return { success: true, path };
      },
    }),
    read_file: tool({
      description: "Read an existing file's contents.",
      inputSchema: z.object({
        path: z.string().describe("Relative path from project root"),
      }),
      execute: async ({ path }) => {
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
      execute: async ({ directory }) => ({
        files: listFiles(projectPath, directory),
      }),
    }),
  };

  return { tools, getFilesWritten: () => [...filesWritten] };
}
