import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.tsx";
import { Pencil } from "lucide-react";
import type { ResolvedAgentConfig, AgentLimitsConfig, ModelPricing, AgentGroup } from "../../../shared/types.ts";

const GROUP_LABELS: Record<AgentGroup, string> = {
  planning: "Planning",
  development: "Development",
  quality: "Quality",
};

const GROUP_ORDER: AgentGroup[] = ["planning", "development", "quality"];

function buildAgentGroups(configs: ResolvedAgentConfig[]) {
  return GROUP_ORDER
    .map((g) => ({ label: GROUP_LABELS[g], agents: configs.filter((c) => c.group === g) }))
    .filter((g) => g.agents.length > 0);
}

const PROVIDERS = ["anthropic", "openai", "google"];

interface ProviderModels {
  provider: string;
  models: Array<{ id: string; pricing: { input: number; output: number } | null }>;
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

  if (configs.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading agent configs...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Override the provider, model, and execution limits for each agent. Changes take effect on the next pipeline run.
      </p>

      {buildAgentGroups(configs).map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
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
  onRefresh,
}: {
  config: ResolvedAgentConfig;
  knownModels: ProviderModels[];
  pricing: PricingInfo[];
  limits?: AgentLimitsConfig;
  saving: boolean;
  onSave: (name: string, provider: string, model: string) => void;
  onReset: (name: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);

  const [editing, setEditing] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");
  const [editMaxTokens, setEditMaxTokens] = useState("");
  const [editMaxSteps, setEditMaxSteps] = useState("");
  const [savingOverrides, setSavingOverrides] = useState(false);

  useEffect(() => {
    setProvider(config.provider);
    setModel(config.model);
  }, [config]);

  const isDirty = provider !== config.provider || model !== config.model;
  const providerModels = knownModels.find((p) => p.provider === provider)?.models || [];

  const modelOptions = providerModels.map((m) => m.id);
  if (model && !modelOptions.includes(model)) {
    modelOptions.unshift(model);
  }

  const pricingInfo = pricing.find((p) => p.model === model);
  const hasOverrides = pricingInfo?.isOverridden || limits?.isOverridden;

  function openEdit() {
    setEditInput(String(pricingInfo?.input ?? ""));
    setEditOutput(String(pricingInfo?.output ?? ""));
    setEditMaxTokens(String(limits?.maxOutputTokens ?? ""));
    setEditMaxSteps(String(limits?.maxToolSteps ?? ""));
    setEditing(true);
  }

  async function handleSaveOverrides() {
    setSavingOverrides(true);
    try {
      const inp = parseFloat(editInput);
      const out = parseFloat(editOutput);
      if (!isNaN(inp) && !isNaN(out) && inp >= 0 && out >= 0) {
        await api.put(`/settings/pricing/${model}`, { input: inp, output: out });
      }
      const tokens = parseInt(editMaxTokens);
      const steps = parseInt(editMaxSteps);
      if (!isNaN(tokens) && !isNaN(steps) && tokens >= 1 && steps >= 1) {
        await api.put(`/settings/agents/${config.name}/limits`, { maxOutputTokens: tokens, maxToolSteps: steps });
      }
      setEditing(false);
      await onRefresh();
    } finally {
      setSavingOverrides(false);
    }
  }

  async function handleResetOverrides() {
    setSavingOverrides(true);
    try {
      if (pricingInfo?.isOverridden) await api.delete(`/settings/pricing/${model}`);
      if (limits?.isOverridden) await api.delete(`/settings/agents/${config.name}/limits`);
      setEditing(false);
      await onRefresh();
    } finally {
      setSavingOverrides(false);
    }
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{config.displayName}</span>
          {config.isOverridden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              custom
            </span>
          )}
        </div>
        {config.isOverridden && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReset(config.name)}
            disabled={saving}
            className="h-6 px-2 text-xs text-muted-foreground"
          >
            Reset
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Select
          value={provider}
          onValueChange={(val) => {
            setProvider(val);
            const firstModel = knownModels.find((p) => p.provider === val)?.models[0];
            if (firstModel) setModel(firstModel.id);
          }}
        >
          <SelectTrigger className="h-8 text-xs w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isDirty && (
          <Button
            size="sm"
            onClick={() => onSave(config.name, provider, model)}
            disabled={saving}
            className="h-8 text-xs"
          >
            {saving ? "..." : "Save"}
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="mt-1.5 space-y-0.5">
          <div className="flex items-center gap-1.5">
            {pricingInfo ? (
              <span className="text-[11px] text-muted-foreground">
                ${pricingInfo.input} input / ${pricingInfo.output} output per 1M tokens
              </span>
            ) : (
              <span className="text-[11px] text-amber-400">Pricing not configured</span>
            )}
            {pricingInfo?.isOverridden && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">custom</span>
            )}
          </div>
          {limits && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                {limits.maxOutputTokens.toLocaleString()} max tokens / {limits.maxToolSteps} max steps
              </span>
              {limits.isOverridden && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">custom</span>
              )}
            </div>
          )}
          <div className="flex items-center gap-1.5 pt-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={openEdit}
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground gap-1"
            >
              <Pencil className="h-3 w-3" />
              Edit overrides
            </Button>
            {hasOverrides && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetOverrides}
                disabled={savingOverrides}
                className="h-5 px-1.5 text-[10px] text-muted-foreground"
              >
                Reset overrides
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-md bg-background/50 border border-border/30 p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Input $/1M tokens</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editInput}
                onChange={(e) => setEditInput(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Output $/1M tokens</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editOutput}
                onChange={(e) => setEditOutput(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Max output tokens</label>
              <Input
                type="number"
                min="1"
                value={editMaxTokens}
                onChange={(e) => setEditMaxTokens(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">Max tool steps</label>
              <Input
                type="number"
                min="1"
                value={editMaxSteps}
                onChange={(e) => setEditMaxSteps(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Button
              size="sm"
              onClick={handleSaveOverrides}
              disabled={savingOverrides}
              className="h-7 text-xs"
            >
              {savingOverrides ? "..." : "Save"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={savingOverrides}
              className="h-7 text-xs text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/60 mt-1.5">{config.description}</p>
    </div>
  );
}
