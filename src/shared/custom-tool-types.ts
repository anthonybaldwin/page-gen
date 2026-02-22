// --- Custom Tool Parameter ---

export interface CustomToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
}

// --- Implementation Types ---

export interface HttpToolConfig {
  type: "http";
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers: Record<string, string>;
  bodyTemplate: string; // JSON with {{param}} interpolation
}

export interface JavaScriptToolConfig {
  type: "javascript";
  code: string; // Sandboxed via new Function() with restricted scope
}

export interface ShellToolConfig {
  type: "shell";
  command: string; // Command template with {{param}} interpolation
  cwd?: string;    // Relative to project root
  timeout?: number; // ms, default 30000
}

export type ToolImplementation = HttpToolConfig | JavaScriptToolConfig | ShellToolConfig;

// --- Custom Tool Definition ---

export interface CustomToolDefinition {
  name: string;
  displayName: string;
  description: string;
  parameters: CustomToolParameter[];
  implementation: ToolImplementation;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
