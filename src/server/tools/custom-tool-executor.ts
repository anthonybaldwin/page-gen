import type { CustomToolDefinition, HttpToolConfig, JavaScriptToolConfig, ShellToolConfig } from "../../shared/custom-tool-types.ts";
import { log, logError } from "../services/logger.ts";
import { getPipelineSetting } from "../config/pipeline.ts";

const DEFAULT_HTTP_TIMEOUT = 30_000;
const DEFAULT_SHELL_TIMEOUT = 30_000;
const JS_TIMEOUT = 5_000;

/**
 * Interpolate {{param}} placeholders in a template string.
 */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : "";
  });
}

/**
 * Execute a custom tool with the given parameters.
 * Routes to the appropriate executor based on implementation type.
 */
export async function executeCustomTool(
  tool: CustomToolDefinition,
  params: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const impl = tool.implementation;

  try {
    switch (impl.type) {
      case "http":
        return await executeHttpTool(impl, params, tool.name);
      case "javascript":
        return await executeJavaScriptTool(impl, params, tool.name);
      case "shell":
        return await executeShellTool(impl, params, tool.name);
      default:
        return { success: false, error: `Unknown implementation type: ${(impl as { type: string }).type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("custom-tool", `Execution failed: ${tool.name}`, message);
    return { success: false, error: message };
  }
}

/**
 * HTTP tool executor: fetch() with interpolated URL/body/headers.
 */
async function executeHttpTool(
  config: HttpToolConfig,
  params: Record<string, unknown>,
  toolName: string,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const url = interpolate(config.url, params);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.headers)) {
    headers[key] = interpolate(value, params);
  }

  const fetchOptions: RequestInit = {
    method: config.method,
    headers,
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT),
  };

  if (config.method !== "GET" && config.bodyTemplate) {
    fetchOptions.body = interpolate(config.bodyTemplate, params);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  log("custom-tool", `HTTP ${config.method} ${url}`, { tool: toolName });

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get("content-type") ?? "";

  let result: unknown;
  if (contentType.includes("json")) {
    result = await response.json();
  } else {
    result = await response.text();
  }

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}: ${typeof result === "string" ? result : JSON.stringify(result)}` };
  }

  return { success: true, result };
}

/**
 * JavaScript tool executor: sandboxed via new Function() with restricted scope.
 */
async function executeJavaScriptTool(
  config: JavaScriptToolConfig,
  params: Record<string, unknown>,
  toolName: string,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  log("custom-tool", `JS execute`, { tool: toolName });

  // Restricted globals
  const sandbox = {
    params,
    JSON,
    Math,
    Date,
    String,
    Number,
    Array,
    Object,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    console: { log: () => {}, warn: () => {}, error: () => {} }, // no-op console
  };

  const argNames = Object.keys(sandbox);
  const argValues = Object.values(sandbox);

  const wrappedCode = `
    "use strict";
    return (async () => {
      ${config.code}
    })();
  `;

  const fn = new Function(...argNames, wrappedCode);

  // Execute with timeout
  const result = await Promise.race([
    fn(...argValues),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`JavaScript tool timed out after ${JS_TIMEOUT}ms`)), JS_TIMEOUT)
    ),
  ]);

  return { success: true, result };
}

/**
 * Shell tool executor: Bun.spawn() with interpolated command.
 * Gated behind pipeline.allowShellTools setting.
 */
async function executeShellTool(
  config: ShellToolConfig,
  params: Record<string, unknown>,
  toolName: string,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  // Check if shell tools are allowed
  const allowShell = getPipelineSetting("allowShellTools");
  if (!allowShell) {
    return { success: false, error: "Shell tools are disabled. Enable pipeline.allowShellTools in Settings to use shell-based custom tools." };
  }

  const command = interpolate(config.command, params);
  const timeout = config.timeout ?? DEFAULT_SHELL_TIMEOUT;
  const cwd = config.cwd || undefined;

  log("custom-tool", `Shell: ${command}`, { tool: toolName, cwd });

  const proc = Bun.spawn(["bash", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Timeout handling
  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timer);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { success: false, error: `Exit code ${exitCode}: ${stderr || stdout}` };
  }

  return { success: true, result: stdout.trim() };
}
