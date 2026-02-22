import type { CustomToolDefinition } from "../../shared/custom-tool-types.ts";
import { db, schema } from "../db/index.ts";
import { eq, like } from "drizzle-orm";
import { BUILTIN_TOOL_NAMES } from "../../shared/types.ts";

const KEY_PREFIX = "custom_tool.";

/**
 * Get all custom tool definitions from app_settings.
 */
export function getAllCustomTools(): CustomToolDefinition[] {
  const rows = db.select().from(schema.appSettings).where(like(schema.appSettings.key, `${KEY_PREFIX}%`)).all();
  const tools: CustomToolDefinition[] = [];
  for (const row of rows) {
    try {
      tools.push(JSON.parse(row.value) as CustomToolDefinition);
    } catch {
      // Invalid JSON — skip
    }
  }
  return tools.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get a single custom tool by name.
 */
export function getCustomTool(name: string): CustomToolDefinition | null {
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, `${KEY_PREFIX}${name}`)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as CustomToolDefinition;
  } catch {
    return null;
  }
}

/**
 * Get all enabled custom tool names.
 */
export function getEnabledCustomToolNames(): string[] {
  return getAllCustomTools().filter((t) => t.enabled).map((t) => t.name);
}

/**
 * Save a custom tool definition.
 */
export function saveCustomTool(tool: CustomToolDefinition): void {
  const key = `${KEY_PREFIX}${tool.name}`;
  const value = JSON.stringify(tool);
  const existing = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  if (existing) {
    db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).run();
  } else {
    db.insert(schema.appSettings).values({ key, value }).run();
  }
}

/**
 * Delete a custom tool.
 */
export function deleteCustomTool(name: string): void {
  db.delete(schema.appSettings).where(eq(schema.appSettings.key, `${KEY_PREFIX}${name}`)).run();
}

/**
 * Check if a tool name conflicts with built-in tools.
 */
export function isBuiltinToolName(name: string): boolean {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Validate a custom tool name format.
 */
export function validateToolName(name: string): string | null {
  if (!name) return "Name is required";
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return "Name must match /^[a-z][a-z0-9_-]*$/ (lowercase, start with letter, hyphens and underscores allowed)";
  }
  if (isBuiltinToolName(name)) {
    return `Name "${name}" conflicts with a built-in tool`;
  }
  return null;
}
