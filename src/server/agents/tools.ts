import { tool } from "ai";
import { z } from "zod";
import { writeFile, readFile, listFiles } from "../tools/file-ops.ts";
import { broadcastFilesChanged } from "../ws.ts";
import { log } from "../services/logger.ts";
import { autoCommit } from "../services/versioning.ts";
import { getPipelineSetting } from "../config/pipeline.ts";
import { BLOCKED_PACKAGES } from "../config/packages.ts";
import { getAllCustomTools } from "../tools/custom-tool-registry.ts";
import { executeCustomTool } from "../tools/custom-tool-executor.ts";
import type { CustomToolDefinition } from "../../shared/custom-tool-types.ts";

/**
 * Check a package.json string for blocked native-module dependencies.
 * Returns an error message listing blocked packages, or null if clean.
 */
export function validatePackageJson(content: string): string | null {
  try {
    const pkg = JSON.parse(content);
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    const blocked = Object.keys(allDeps).filter((d) => d in BLOCKED_PACKAGES);
    if (blocked.length === 0) return null;
    return blocked.map((d) => `"${d}" is blocked: ${BLOCKED_PACKAGES[d]}`).join("\n");
  } catch {
    return null; // not valid JSON — let it through
  }
}

/**
 * Strip blocked packages from a package.json string.
 * Returns the cleaned content. Used by the fallback extraction path.
 */
export function stripBlockedPackages(content: string): { cleaned: string; stripped: string[] } {
  try {
    const pkg = JSON.parse(content);
    const stripped: string[] = [];
    for (const field of ["dependencies", "devDependencies"] as const) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (name in BLOCKED_PACKAGES) {
          delete deps[name];
          stripped.push(name);
        }
      }
    }
    return { cleaned: JSON.stringify(pkg, null, 2), stripped };
  } catch {
    return { cleaned: content, stripped: [] };
  }
}

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
        // Block native-module deps before they hit disk
        if (path === "package.json" || path.endsWith("/package.json")) {
          const blocked = validatePackageJson(content);
          if (blocked) {
            log("tool", `write_file blocked for ${path}: native-module deps`, { blocked });
            return { success: false, error: `Blocked dependencies found — remove them and retry:\n${blocked}` };
          }
        }
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
        // Check for blocked deps in any package.json before writing anything
        for (const f of files) {
          if (f.path === "package.json" || f.path.endsWith("/package.json")) {
            const blocked = validatePackageJson(f.content);
            if (blocked) {
              log("tool", `write_files blocked for ${f.path}: native-module deps`, { blocked });
              return { success: false, error: `Blocked dependencies in ${f.path} — remove them and retry:\n${blocked}` };
            }
          }
        }
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
        if (versionCounter >= getPipelineSetting("maxAgentVersionsPerRun")) {
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

  // Add enabled custom tools
  const customTools = getAllCustomTools().filter((t) => t.enabled);
  for (const customTool of customTools) {
    const ctool = buildCustomToolAISDK(customTool);
    if (ctool) {
      (tools as Record<string, unknown>)[customTool.name] = ctool;
    }
  }

  return { tools, getFilesWritten: () => [...filesWritten] };
}

/**
 * Build an AI SDK tool() from a CustomToolDefinition.
 */
function buildCustomToolAISDK(def: CustomToolDefinition) {
  try {
    // Build Zod schema from parameter definitions
    const schemaFields: Record<string, z.ZodTypeAny> = {};
    for (const param of def.parameters) {
      let field: z.ZodTypeAny;
      switch (param.type) {
        case "number":
          field = z.number().describe(param.description);
          break;
        case "boolean":
          field = z.boolean().describe(param.description);
          break;
        default:
          field = z.string().describe(param.description);
      }
      schemaFields[param.name] = param.required ? field : field.optional();
    }

    const inputSchema = z.object(schemaFields);

    return tool({
      description: def.description,
      inputSchema,
      execute: async (params: Record<string, unknown>) => {
        const result = await executeCustomTool(def, params);
        return result;
      },
    });
  } catch (err) {
    log("custom-tool", `Failed to build AI SDK tool for "${def.name}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
