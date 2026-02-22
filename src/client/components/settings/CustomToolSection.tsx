import { useState, useEffect } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { CustomToolEditor } from "./CustomToolEditor.tsx";
import type { CustomToolDefinition } from "../../../shared/custom-tool-types.ts";
import { Wrench, Plus, Trash2, Pencil } from "lucide-react";

interface CustomToolSectionProps {
  onToolsChanged?: () => void;
}

export function CustomToolSection({ onToolsChanged }: CustomToolSectionProps) {
  const [tools, setTools] = useState<CustomToolDefinition[]>([]);
  const [editingTool, setEditingTool] = useState<CustomToolDefinition | undefined>();
  const [showEditor, setShowEditor] = useState(false);

  const refresh = async () => {
    try {
      const data = await api.get<CustomToolDefinition[]>("/settings/custom-tools");
      setTools(data);
    } catch (err) {
      console.error("[custom-tools] Load failed:", err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleToggle = async (tool: CustomToolDefinition) => {
    try {
      await api.put(`/settings/custom-tools/${tool.name}`, { ...tool, enabled: !tool.enabled });
      await refresh();
      onToolsChanged?.();
    } catch (err) {
      console.error("[custom-tools] Toggle failed:", err);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await api.delete(`/settings/custom-tools/${name}`);
      await refresh();
      onToolsChanged?.();
    } catch (err) {
      console.error("[custom-tools] Delete failed:", err);
    }
  };

  const handleEdit = (tool: CustomToolDefinition) => {
    setEditingTool(tool);
    setShowEditor(true);
  };

  const handleCreate = () => {
    setEditingTool(undefined);
    setShowEditor(true);
  };

  const handleEditorDone = () => {
    setShowEditor(false);
    setEditingTool(undefined);
    refresh();
    onToolsChanged?.();
  };

  if (showEditor) {
    return (
      <CustomToolEditor
        tool={editingTool}
        onSave={handleEditorDone}
        onCancel={() => { setShowEditor(false); setEditingTool(undefined); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Custom Tools</h3>
        <Button variant="outline" size="sm" onClick={handleCreate} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> Add Tool
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Define custom tools (HTTP, JavaScript, Shell) that agents can use during pipeline runs. Enable them per agent in the toggle grid above.
      </p>

      {tools.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No custom tools defined yet.</p>
      )}

      {tools.map((tool) => (
        <div
          key={tool.name}
          className={`rounded-lg border border-border/50 p-3 ${!tool.enabled ? "opacity-50" : ""}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{tool.displayName}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {tool.name} &middot; {tool.implementation.type} &middot; {tool.parameters.length} param{tool.parameters.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleToggle(tool)}
                className={`w-8 h-4 rounded-full transition-colors ${tool.enabled ? "bg-primary" : "bg-muted"}`}
              >
                <div className={`w-3 h-3 rounded-full bg-white transition-transform ${tool.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <Button variant="ghost" size="sm" onClick={() => handleEdit(tool)} className="h-6 w-6 p-0">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(tool.name)} className="h-6 w-6 p-0 text-destructive">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {tool.description && (
            <p className="text-xs text-muted-foreground mt-1 pl-6">{tool.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
