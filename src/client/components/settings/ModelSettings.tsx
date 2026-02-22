import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "../ui/select.tsx";
import type { ResolvedAgentConfig, AgentLimitsConfig, ModelPricing, AgentGroup } from "../../../shared/types.ts";
import { PROVIDER_IDS, CATEGORY_LABELS, CATEGORY_ORDER, type ModelCategory } from "../../../shared/providers.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
  custom: "Custom Agents",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality", "custom"];

function buildAgentGroups(configs: ResolvedAgentConfig[]) {
  return GROUP_ORDER
    .map((g) => ({ label: GROUP_LABELS[g], agents: configs.filter((c) => c.group === g) }))
    .filter((g) => g.agents.length > 0);
}

interface ProviderModels {
  provider: string;
  models: Array<{ id: string; pricing: { input: number; output: number } | null; category?: string }>;
}

interface PricingInfo extends ModelPricing {
  model: string;
}

export function ModelSettings() {
  const [configs, setConfigs] = useState<ResolvedAgentConfig[]>([]);
  const [knownModels, setKnownModels] = useState<ProviderModels[]>([]);
  const [pricing, setPricing] = useState<PricingInfo[]>([]);
  const [limits, setLimits] = useState<AgentLimitsConfig[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const refresh = async () => {
    const [agents, models, prices, lims] = await Promise.all([
      api.get<ResolvedAgentConfig[]>("/settings/agents"),
      api.get<ProviderModels[]>("/settings/models"),
      api.get<PricingInfo[]>("/settings/pricing"),
      api.get<AgentLimitsConfig[]>("/settings/agents/limits"),
    ]);
    setConfigs(agents);
    setKnownModels(models);
    setPricing(prices);
    setLimits(lims);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  async function handleSave(name: string, provider: string, model: string) {
    setSaving(name);
    try {
      await api.put(`/settings/agents/${name}`, { provider, model });
      await refresh();
    } catch (err) {
      console.error("[model-settings] Save failed:", err);
    } finally {
      setSaving(null);
    }
  }

  async function handleReset(name: string) {
    setSaving(name);
    try {
      await api.delete(`/settings/agents/${name}/overrides`);
      await refresh();
    } catch (err) {
      console.error("[model-settings] Reset failed:", err);
    } finally {
      setSaving(null);
    }
  }

  async function handleDeleteCustomAgent(name: string) {
    setSaving(name);
    try {
      await api.delete(`/settings/custom-agents/${name}`);
      await refresh();
    } catch (err) {
      console.error("[model-settings] Delete custom agent failed:", err);
    } finally {
      setSaving(null);
    }
  }

  if (configs.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading agent configs...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Override the provider, model, and execution limits for each agent. Changes take effect on the next pipeline run.
        </p>
        {!showAddForm && (
          <Button variant="outline" size="sm" onClick={() => setShowAddForm(true)} className="text-xs shrink-0 ml-4">
            + Add Custom Agent
          </Button>
        )}
      </div>

      {showAddForm && (
        <AddAgentForm
          knownModels={knownModels}
          onCreated={() => { setShowAddForm(false); refresh(); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {buildAgentGroups(configs).map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {group.agents.map((config) => (
                <AgentModelCard
                  key={config.name}
                  config={config}
                  knownModels={knownModels}
                  pricing={pricing}
                  limits={limits.find((l) => l.name === config.name)}
                  saving={saving === config.name}
                  onSave={handleSave}
                  onReset={handleReset}
                  onDelete={!config.isBuiltIn ? handleDeleteCustomAgent : undefined}
                  onRefresh={refresh}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentModelCard({
  config,
  knownModels,
  pricing,
  limits,
  saving,
  onSave,
  onReset,
  onDelete,
  onRefresh,
}: {
  config: ResolvedAgentConfig;
  knownModels: ProviderModels[];
  pricing: PricingInfo[];
  limits?: AgentLimitsConfig;
  saving: boolean;
  onSave: (name: string, provider: string, model: string) => void;
  onReset: (name: string) => void;
  onDelete?: (name: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);

  const [editing, setEditing] = useState(false);
  const [editMaxTokens, setEditMaxTokens] = useState("");
  const [editMaxSteps, setEditMaxSteps] = useState("");
  const [savingLimits, setSavingLimits] = useState(false);

  useEffect(() => {
    setProvider(config.provider);
    setModel(config.model);
  }, [config]);

  const isDirty = provider !== config.provider || model !== config.model;
  const allProviderModels = knownModels.find((p) => p.provider === provider)?.models || [];

  // Filter models by agent's allowed categories
  const allowedCategories = config.allowedCategories;
  const providerModels = allowedCategories && allowedCategories.length > 0
    ? allProviderModels.filter((m) => allowedCategories.includes((m.category ?? "text") as string))
    : allProviderModels;

  const modelOptions = providerModels.map((m) => m.id);
  if (model && !modelOptions.includes(model)) {
    modelOptions.unshift(model);
  }

  // Group models by category for dropdown
  const modelsByCategory = new Map<ModelCategory, string[]>();
  for (const m of providerModels) {
    const cat = (m.category ?? "text") as ModelCategory;
    if (!modelsByCategory.has(cat)) modelsByCategory.set(cat, []);
    modelsByCategory.get(cat)!.push(m.id);
  }
  // Ensure current model appears even if not in providerModels
  if (model && !providerModels.find((m) => m.id === model)) {
    const cat: ModelCategory = "text";
    if (!modelsByCategory.has(cat)) modelsByCategory.set(cat, []);
    modelsByCategory.get(cat)!.unshift(model);
  }
  const sortedCategories = CATEGORY_ORDER.filter((c) => modelsByCategory.has(c));
  const hasMultipleCategories = sortedCategories.length > 1;

  const pricingInfo = pricing.find((p) => p.model === model);
  const selectedModelCategory = providerModels.find((m) => m.id === model)?.category ?? pricingInfo?.category ?? "text";
  const isReasoningModel = selectedModelCategory === "reasoning";
  const hasLimitsOverride = !!limits?.isOverridden;

  function openEdit() {
    setEditMaxTokens(String(limits?.maxOutputTokens ?? ""));
    setEditMaxSteps(String(limits?.maxToolSteps ?? ""));
    setEditing(true);
  }

  async function handleLimitsSave() {
    setSavingLimits(true);
    try {
      const tokens = parseInt(editMaxTokens);
      const steps = parseInt(editMaxSteps);
      if (!isNaN(tokens) && !isNaN(steps) && tokens >= 1 && steps >= 1) {
        await api.put(`/settings/agents/${config.name}/limits`, { maxOutputTokens: tokens, maxToolSteps: steps });
      }
      setEditing(false);
      await onRefresh();
    } finally {
      setSavingLimits(false);
    }
  }

  async function handleLimitsReset() {
    setSavingLimits(true);
    try {
      await api.delete(`/settings/agents/${config.name}/limits`);
      setEditing(false);
      await onRefresh();
    } finally {
      setSavingLimits(false);
    }
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border/50 p-2.5">
      {/* Row 1: Name + badges + actions */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-foreground">{config.displayName}</span>
          {!config.isBuiltIn && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400">custom</span>
          )}
          {isReasoningModel && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-400">reasoning</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(config.name)} disabled={saving}
              className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive">Delete</Button>
          )}
          {hasLimitsOverride && (
            <Button variant="ghost" size="sm" onClick={handleLimitsReset} disabled={savingLimits}
              className="h-5 px-1.5 text-[10px] text-muted-foreground">Reset limits</Button>
          )}
          {config.isOverridden && (
            <Button variant="ghost" size="sm" onClick={() => onReset(config.name)} disabled={saving}
              className="h-5 px-1.5 text-[10px] text-muted-foreground">Reset model</Button>
          )}
        </div>
      </div>

      {/* Row 2: Provider + Model dropdowns */}
      <div className="flex gap-1.5">
        <Select
          value={provider}
          onValueChange={(val) => {
            setProvider(val);
            const newModels = knownModels.find((p) => p.provider === val)?.models || [];
            const filtered = allowedCategories && allowedCategories.length > 0
              ? newModels.filter((m) => allowedCategories.includes((m.category ?? "text") as string))
              : newModels;
            const firstModel = filtered[0];
            if (firstModel) setModel(firstModel.id);
          }}
        >
          <SelectTrigger className="h-7 text-[11px] w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_IDS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="h-7 text-[11px] flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hasMultipleCategories ? (
              sortedCategories.map((cat) => (
                <SelectGroup key={cat}>
                  <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70 px-2 py-1">
                    {CATEGORY_LABELS[cat]}
                  </SelectLabel>
                  {modelsByCategory.get(cat)!.map((m) => (
                    <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
                  ))}
                </SelectGroup>
              ))
            ) : (
              modelOptions.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {isDirty && (
          <Button size="sm" onClick={() => onSave(config.name, provider, model)} disabled={saving} className="h-7 text-[11px]">
            {saving ? "..." : "Save"}
          </Button>
        )}
      </div>

      {/* Row 3: Pricing + limits inline (or expanded edit) */}
      {!editing ? (
        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground flex-wrap">
          {pricingInfo ? (
            <span>${pricingInfo.input}/${pricingInfo.output} per 1M</span>
          ) : (
            <span className="text-amber-400">No pricing</span>
          )}
          {limits && (
            <>
              <span className="text-border">·</span>
              <button onClick={openEdit} className="hover:text-foreground transition-colors" title="Click to edit limits">
                tokens: {limits.maxOutputTokens.toLocaleString()} · steps: {limits.maxToolSteps}
                {hasLimitsOverride && <span className="text-primary ml-1">*</span>}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Tokens:</label>
            <Input type="number" min="1" value={editMaxTokens} onChange={(e) => setEditMaxTokens(e.target.value)}
              disabled={savingLimits} className="w-20 h-6 text-[11px]" />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Steps:</label>
            <Input type="number" min="1" value={editMaxSteps} onChange={(e) => setEditMaxSteps(e.target.value)}
              disabled={savingLimits} className="w-16 h-6 text-[11px]" />
          </div>
          <Button size="sm" onClick={handleLimitsSave} disabled={savingLimits} className="h-6 px-2 text-[10px]">
            {savingLimits ? "..." : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={savingLimits}
            className="h-6 px-1.5 text-[10px] text-muted-foreground">Cancel</Button>
        </div>
      )}
    </div>
  );
}

function AddAgentForm({
  knownModels,
  onCreated,
  onCancel,
}: {
  knownModels: ProviderModels[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState(PROVIDER_IDS[0]);
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const providerModels = knownModels.find((p) => p.provider === provider)?.models || [];

  useEffect(() => {
    const first = providerModels[0];
    if (first && !model) setModel(first.id);
  }, [provider]);

  async function handleSubmit() {
    setError("");
    setSaving(true);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>("/settings/custom-agents", {
        name,
        displayName,
        provider,
        model,
        description,
      });
      if (res.error) {
        setError(res.error);
      } else {
        onCreated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border/50 p-3 space-y-3">
      <h4 className="text-xs font-medium text-foreground">New Custom Agent</h4>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Name (slug)</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-agent"
            className="h-7 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Display name</label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My Agent"
            className="h-7 text-xs"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="w-[120px]">
          <label className="text-[10px] text-muted-foreground block mb-1">Provider</label>
          <Select value={provider} onValueChange={(val) => { setProvider(val); setModel(""); }}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_IDS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-muted-foreground block mb-1">Model</label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providerModels.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">{m.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Description</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this agent does..."
          className="h-7 text-xs"
        />
      </div>

      {error && (
        <p className="text-[11px] text-destructive">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={saving || !name || !displayName || !model || !description} className="h-7 text-xs">
          {saving ? "Creating..." : "Create Agent"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="h-7 text-xs text-muted-foreground">
          Cancel
        </Button>
      </div>
    </div>
  );
}
