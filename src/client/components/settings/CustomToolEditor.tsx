import { useState } from "react";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import type { CustomToolDefinition, CustomToolParameter, ToolImplementation, HttpToolConfig, JavaScriptToolConfig, ShellToolConfig } from "../../../shared/custom-tool-types.ts";
import { api } from "../../lib/api.ts";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";

interface CustomToolEditorProps {
  tool?: CustomToolDefinition;
  onSave: () => void;
  onCancel: () => void;
}

const DEFAULT_HTTP: HttpToolConfig = { type: "http", url: "", method: "GET", headers: {}, bodyTemplate: "" };
const DEFAULT_JS: JavaScriptToolConfig = { type: "javascript", code: "// Access params via the `params` object\nreturn { result: params.input };" };
const DEFAULT_SHELL: ShellToolConfig = { type: "shell", command: "", timeout: 30000 };

export function CustomToolEditor({ tool, onSave, onCancel }: CustomToolEditorProps) {
  const isNew = !tool;
  const [name, setName] = useState(tool?.name ?? "");
  const [displayName, setDisplayName] = useState(tool?.displayName ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [parameters, setParameters] = useState<CustomToolParameter[]>(tool?.parameters ?? []);
  const [implType, setImplType] = useState<"http" | "javascript" | "shell">(tool?.implementation.type ?? "http");
  const [httpConfig, setHttpConfig] = useState<HttpToolConfig>(
    tool?.implementation.type === "http" ? tool.implementation : DEFAULT_HTTP,
  );
  const [jsConfig, setJsConfig] = useState<JavaScriptToolConfig>(
    tool?.implementation.type === "javascript" ? tool.implementation : DEFAULT_JS,
  );
  const [shellConfig, setShellConfig] = useState<ShellToolConfig>(
    tool?.implementation.type === "shell" ? tool.implementation : DEFAULT_SHELL,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  function getImplementation(): ToolImplementation {
    switch (implType) {
      case "http": return httpConfig;
      case "javascript": return jsConfig;
      case "shell": return shellConfig;
    }
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const def: CustomToolDefinition = {
        name,
        displayName,
        description,
        parameters,
        implementation: getImplementation(),
        enabled: tool?.enabled ?? true,
        createdAt: tool?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await api.put(`/settings/custom-tools/${name}`, def);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    try {
      // First save, then test
      const def: CustomToolDefinition = {
        name,
        displayName,
        description,
        parameters,
        implementation: getImplementation(),
        enabled: true,
        createdAt: tool?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      await api.put(`/settings/custom-tools/${name}`, def);

      // Build sample params
      const sampleParams: Record<string, unknown> = {};
      for (const p of parameters) {
        sampleParams[p.name] = p.type === "number" ? 0 : p.type === "boolean" ? false : "test";
      }

      const result = await api.post<{ success: boolean; result?: unknown; error?: string }>(
        `/settings/custom-tools/${name}/test`,
        { params: sampleParams },
      );
      setTestResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function addParameter() {
    setParameters([...parameters, { name: "", type: "string", description: "", required: true }]);
  }

  function updateParameter(index: number, updates: Partial<CustomToolParameter>) {
    setParameters(parameters.map((p, i) => i === index ? { ...p, ...updates } : p));
  }

  function removeParameter(index: number) {
    setParameters(parameters.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{isNew ? "Create Custom Tool" : `Edit: ${tool.displayName}`}</h3>

      {error && <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded">{error}</div>}

      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Name (unique ID)</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew}
            className="mt-1 h-8 text-xs font-mono"
            placeholder="fetch_weather"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Display Name</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 h-8 text-xs"
            placeholder="Fetch Weather"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-muted-foreground">Description (shown to LLM)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs resize-y"
          placeholder="Fetches current weather for a given city name"
        />
      </label>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Parameters</span>
          <Button variant="outline" size="sm" onClick={addParameter} className="h-6 text-xs">+ Add</Button>
        </div>
        {parameters.length === 0 && (
          <p className="text-xs text-muted-foreground">No parameters defined.</p>
        )}
        {parameters.map((param, i) => (
          <div key={i} className="flex items-center gap-2 mb-2">
            <Input
              value={param.name}
              onChange={(e) => updateParameter(i, { name: e.target.value })}
              className="h-7 text-xs font-mono flex-1"
              placeholder="name"
            />
            <select
              value={param.type}
              onChange={(e) => updateParameter(i, { type: e.target.value as "string" | "number" | "boolean" })}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            <Input
              value={param.description}
              onChange={(e) => updateParameter(i, { description: e.target.value })}
              className="h-7 text-xs flex-[2]"
              placeholder="Description"
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
              <input
                type="checkbox"
                checked={param.required}
                onChange={(e) => updateParameter(i, { required: e.target.checked })}
              />
              Req
            </label>
            <Button variant="ghost" size="sm" onClick={() => removeParameter(i)} className="h-6 px-1 text-xs text-destructive">
              X
            </Button>
          </div>
        ))}
      </div>

      {/* Implementation type tabs */}
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-2">Implementation</span>
        <div className="flex gap-1 mb-3">
          {(["http", "javascript", "shell"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setImplType(t)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                implType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t === "http" ? "HTTP" : t === "javascript" ? "JavaScript" : "Shell"}
            </button>
          ))}
        </div>

        {implType === "http" && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={httpConfig.method}
                onChange={(e) => setHttpConfig({ ...httpConfig, method: e.target.value as HttpToolConfig["method"] })}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              >
                {["GET", "POST", "PUT", "DELETE", "PATCH"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Input
                value={httpConfig.url}
                onChange={(e) => setHttpConfig({ ...httpConfig, url: e.target.value })}
                className="h-8 text-xs flex-1 font-mono"
                placeholder="https://api.example.com/{{param}}"
              />
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">Body Template (JSON, use {"{{param}}"} for interpolation)</span>
              <CodeMirror
                value={httpConfig.bodyTemplate}
                onChange={(val) => setHttpConfig({ ...httpConfig, bodyTemplate: val })}
                extensions={[json()]}
                height="80px"
                className="mt-1 border border-border rounded text-xs"
              />
            </label>
          </div>
        )}

        {implType === "javascript" && (
          <div className="space-y-2">
            <div className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-1 rounded">
              Runs on your machine with server-level access. Access params via the `params` object.
            </div>
            <CodeMirror
              value={jsConfig.code}
              onChange={(val) => setJsConfig({ ...jsConfig, code: val })}
              extensions={[javascript()]}
              height="120px"
              className="border border-border rounded text-xs"
            />
          </div>
        )}

        {implType === "shell" && (
          <div className="space-y-2">
            <div className="text-[10px] text-red-600 bg-red-500/10 px-2 py-1 rounded">
              Shell tools execute commands on your machine. Must be enabled in Settings &gt; Limits &gt; Pipeline Settings (allowShellTools).
            </div>
            <Input
              value={shellConfig.command}
              onChange={(e) => setShellConfig({ ...shellConfig, command: e.target.value })}
              className="h-8 text-xs font-mono"
              placeholder="curl -s https://api.example.com/{{param}}"
            />
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="text-xs text-muted-foreground">Working directory (relative to project)</span>
                <Input
                  value={shellConfig.cwd ?? ""}
                  onChange={(e) => setShellConfig({ ...shellConfig, cwd: e.target.value || undefined })}
                  className="mt-1 h-7 text-xs font-mono"
                  placeholder="."
                />
              </label>
              <label className="block w-28">
                <span className="text-xs text-muted-foreground">Timeout (ms)</span>
                <Input
                  type="number"
                  value={shellConfig.timeout ?? 30000}
                  onChange={(e) => setShellConfig({ ...shellConfig, timeout: Number(e.target.value) })}
                  className="mt-1 h-7 text-xs"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Test panel */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleTest} className="h-7 text-xs" disabled={!name}>
          Test
        </Button>
        {testResult && (
          <pre className="text-[10px] text-muted-foreground bg-muted p-2 rounded flex-1 overflow-x-auto max-h-20">
            {testResult}
          </pre>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 text-xs">Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !name || !displayName} className="h-8 text-xs">
          {saving ? "Saving..." : isNew ? "Create" : "Save"}
        </Button>
      </div>
    </div>
  );
}
