import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { ConfirmDialog, PromptDialog } from "../ui/confirm-dialog.tsx";
import { FlowCanvas } from "../flow/FlowCanvas.tsx";
import { FlowNodeInspector } from "../flow/FlowNodeInspector.tsx";
import { FlowToolbar } from "../flow/FlowToolbar.tsx";
import { PipelineSettings, type PipelineConfig } from "./PipelineSettings.tsx";
import { Trash2, Plus } from "lucide-react";
import type { FlowTemplate, FlowNode, FlowEdge, FlowNodeData } from "../../../shared/flow-types.ts";
import { validateFlowTemplate, type ValidationError } from "../../../shared/flow-validation.ts";
import type { OrchestratorIntent } from "../../../shared/types.ts";
import type { ResolvedAgentConfig } from "../../../shared/types.ts";
import { nanoid } from "nanoid";

type IntentTab = OrchestratorIntent;
type PipelineSubTab = "editor" | "defaults";

export function FlowEditorTab() {
  const [templates, setTemplates] = useState<FlowTemplate[]>([]);
  const [activeBindings, setActiveBindings] = useState<Record<string, string>>({});
  const [activeIntent, setActiveIntent] = useState<IntentTab>("build");
  const [selectedTemplate, setSelectedTemplate] = useState<FlowTemplate | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editNodes, setEditNodes] = useState<FlowNode[]>([]);
  const [editEdges, setEditEdges] = useState<FlowEdge[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validated, setValidated] = useState(false);
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<PipelineSubTab>("editor");
  const [pipelineDefaults, setPipelineDefaults] = useState<PipelineConfig | null>(null);

  // Dialog state
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FlowTemplate | null>(null);
  const [newPipelineDialogOpen, setNewPipelineDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [tmpls, bindings, agents, pipelineCfg] = await Promise.all([
        api.get<FlowTemplate[]>("/settings/flow/templates"),
        api.get<Record<string, string>>("/settings/flow/active"),
        api.get<ResolvedAgentConfig[]>("/settings/agents"),
        api.get<{ settings: PipelineConfig; defaults: PipelineConfig }>("/settings/pipeline"),
      ]);
      setTemplates(tmpls);
      setActiveBindings(bindings);
      setAgentNames(agents.map((a) => a.name));
      setPipelineDefaults(pipelineCfg.settings);

      // Auto-select the active template for the current intent
      const activeId = bindings[activeIntent];
      const active = tmpls.find((t) => t.id === activeId) ?? tmpls.find((t) => t.intent === activeIntent) ?? null;
      if (active) {
        setSelectedTemplate(active);
        setEditNodes(active.nodes);
        setEditEdges(active.edges);
        setDirty(false);
      }
    } catch (err) {
      console.error("[flow-editor] Load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [activeIntent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleIntentChange = (intent: IntentTab) => {
    setActiveIntent(intent);
    setSelectedNodeId(null);
    setErrors([]);
    setValidated(false);
  };

  const handleTemplateSelect = (template: FlowTemplate) => {
    setSelectedTemplate(template);
    setEditNodes(template.nodes);
    setEditEdges(template.edges);
    setSelectedNodeId(null);
    setDirty(false);
    setErrors([]);
    setValidated(false);
  };

  const handleCanvasChange = (nodes: FlowNode[], edges: FlowEdge[]) => {
    setEditNodes(nodes);
    setEditEdges(edges);
    setDirty(true);
    setValidated(false);
  };

  const handleAddNode = (node: FlowNode) => {
    setEditNodes((prev) => [...prev, node]);
    setDirty(true);
  };

  const handleNodeUpdate = (nodeId: string, data: FlowNodeData) => {
    setEditNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, data } : n));
    setDirty(true);
  };

  const handleNodeDelete = (nodeId: string) => {
    setEditNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEditEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNodeId(null);
    setDirty(true);
  };

  const handleValidate = () => {
    if (!selectedTemplate) return;
    const tmpl = { ...selectedTemplate, nodes: editNodes, edges: editEdges };
    const result = validateFlowTemplate(tmpl, agentNames);
    setErrors(result);
    setValidated(true);
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    try {
      const updated: FlowTemplate = {
        ...selectedTemplate,
        nodes: editNodes,
        edges: editEdges,
        updatedAt: Date.now(),
      };
      await api.put(`/settings/flow/templates/${updated.id}`, updated);
      setDirty(false);
      setErrors([]);
      await refresh();
    } catch (err) {
      console.error("[flow-editor] Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async (templateId: string) => {
    try {
      await api.put("/settings/flow/active", { intent: activeIntent, templateId });
      await refresh();
    } catch (err) {
      console.error("[flow-editor] Set active failed:", err);
    }
  };

  const handleReset = async () => {
    if (!selectedTemplate) return;
    try {
      const res = await api.post<{ ok: boolean; template: FlowTemplate }>(`/settings/flow/templates/${selectedTemplate.id}/reset`, {});
      if (res.template) {
        setSelectedTemplate(res.template);
        setEditNodes(res.template.nodes);
        setEditEdges(res.template.edges);
        setDirty(false);
        setErrors([]);
        setValidated(false);
      }
      await refresh();
    } catch (err) {
      console.error("[flow-editor] Reset failed:", err);
    } finally {
      setResetDialogOpen(false);
    }
  };

  const handleAddPipeline = async (name: string) => {
    const now = Date.now();
    const newTemplate: FlowTemplate = {
      id: `${activeIntent}-${nanoid(8)}`,
      name,
      description: "",
      intent: activeIntent,
      version: 1,
      enabled: true,
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
      isDefault: false,
    };
    try {
      const res = await api.post<{ ok: boolean; template: FlowTemplate }>("/settings/flow/templates", newTemplate);
      // Server auto-populates default nodes — use the returned template
      const created = res.template ?? newTemplate;
      await refresh();
      setSelectedTemplate(created);
      setEditNodes(created.nodes);
      setEditEdges(created.edges);
      setDirty(false);
    } catch (err) {
      console.error("[flow-editor] Create pipeline failed:", err);
    } finally {
      setNewPipelineDialogOpen(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/settings/flow/templates/${deleteTarget.id}`);
      if (selectedTemplate?.id === deleteTarget.id) {
        setSelectedTemplate(null);
        setEditNodes([]);
        setEditEdges([]);
      }
      await refresh();
    } catch (err) {
      console.error("[flow-editor] Delete failed:", err);
    } finally {
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading flow templates...</p>;
  }

  const intentTemplates = templates.filter((t) => t.intent === activeIntent);
  const selectedNode = editNodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Sub-tab toggle + intent tabs on one row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          {(["editor", "defaults"] as PipelineSubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setSubTab(tab)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                subTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {tab === "editor" ? "Flow Editor" : "Defaults"}
            </button>
          ))}
        </div>

        {subTab === "editor" && (
          <>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1">
              {(["build", "fix", "question"] as IntentTab[]).map((intent) => (
                <button
                  key={intent}
                  onClick={() => handleIntentChange(intent)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    activeIntent === intent
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {intent.charAt(0).toUpperCase() + intent.slice(1)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {subTab === "defaults" && (
        <div className="overflow-y-auto flex-1">
          <PipelineSettings />
        </div>
      )}

      {subTab === "editor" && <>

      {/* Template picker */}
      <div>
        <div className="flex flex-wrap gap-2 items-center">
          {intentTemplates.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No pipelines for {activeIntent}.{" "}
              <button
                onClick={async () => {
                  try {
                    await api.post("/settings/flow/defaults", {});
                    await refresh();
                  } catch (err) {
                    console.error("[flow-editor] Generate default failed:", err);
                  }
                }}
                className="text-primary hover:underline"
              >
                Generate default
              </button>
            </div>
          )}
          {intentTemplates.map((tmpl) => {
            const isActive = activeBindings[activeIntent] === tmpl.id;
            const isSelected = selectedTemplate?.id === tmpl.id;
            return (
              <div
                key={tmpl.id}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 cursor-pointer transition-colors ${
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
                onClick={() => handleTemplateSelect(tmpl)}
              >
                {/* Radio-style indicator */}
                <div
                  className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                    isActive ? "border-primary bg-primary" : "border-muted-foreground/40"
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{tmpl.name}</div>
                  <div className="text-[10px] text-muted-foreground">{tmpl.nodes.length} nodes</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isActive ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">active</span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleSetActive(tmpl.id); }}
                      className="h-5 px-1.5 text-[10px]"
                    >
                      Set Active
                    </Button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(tmpl); setDeleteDialogOpen(true); }}
                    disabled={isActive}
                    className={`p-0.5 rounded transition-colors ${
                      isActive
                        ? "text-muted-foreground/30 cursor-not-allowed"
                        : "text-muted-foreground hover:text-destructive"
                    }`}
                    title={isActive ? "Cannot delete active template" : "Delete template"}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {/* Add pipeline button */}
          <button
            onClick={() => setNewPipelineDialogOpen(true)}
            className="flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
          >
            <Plus className="h-3 w-3" /> New Pipeline
          </button>
        </div>
      </div>

      {/* Canvas + Inspector */}
      {selectedTemplate && (
        <>
          <FlowToolbar
            onAddNode={handleAddNode}
            onValidate={handleValidate}
            onSave={handleSave}
            onReset={() => setResetDialogOpen(true)}
            saving={saving}
            errors={errors}
            dirty={dirty}
            validated={validated}
          />

          <div className="flex gap-0 rounded-lg border border-border overflow-hidden flex-1 min-h-0">
            <div className="flex-1 min-w-0">
              <FlowCanvas
                key={selectedTemplate.id}
                template={{ ...selectedTemplate, nodes: editNodes, edges: editEdges }}
                onChange={handleCanvasChange}
                onNodeSelect={setSelectedNodeId}
              />
            </div>
            {selectedNode && (
              <FlowNodeInspector
                node={selectedNode}
                agentNames={agentNames}
                onUpdate={handleNodeUpdate}
                onDelete={handleNodeDelete}
                pipelineDefaults={pipelineDefaults}
              />
            )}
          </div>

          {/* Validation errors */}
          {errors.length > 0 && (
            <div className="space-y-1">
              {errors.map((err, i) => (
                <div
                  key={i}
                  className={`text-xs px-3 py-1.5 rounded ${
                    err.type === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {err.message}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      </>}

      {/* Dialogs */}
      <ConfirmDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        title="Reset Pipeline"
        description={`Reset "${selectedTemplate?.name}" to its default layout? This will discard all customizations.`}
        confirmLabel="Reset"
        onConfirm={handleReset}
        destructive
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => { setDeleteDialogOpen(open); if (!open) setDeleteTarget(null); }}
        title="Delete Pipeline"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteTemplate}
        destructive
      />
      <PromptDialog
        open={newPipelineDialogOpen}
        onOpenChange={setNewPipelineDialogOpen}
        title="New Pipeline"
        description={`Create a new ${activeIntent} pipeline.`}
        defaultValue={`Custom ${activeIntent.charAt(0).toUpperCase() + activeIntent.slice(1)} Pipeline`}
        placeholder="Pipeline name"
        confirmLabel="Create"
        onConfirm={handleAddPipeline}
      />
    </div>
  );
}
