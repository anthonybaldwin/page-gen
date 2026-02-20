import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { Button } from "../ui/button.tsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.tsx";
import type { ResolvedAgentConfig, ModelPricing } from "../../../shared/types.ts";

const AGENT_GROUPS: { label: string; agents: string[] }[] = [
  { label: "Planning", agents: ["orchestrator", "orchestrator:classify", "orchestrator:question", "orchestrator:summary", "research", "architect", "testing"] },
  { label: "Development", agents: ["frontend-dev", "backend-dev", "styling"] },
  { label: "Quality", agents: ["code-review", "qa", "security"] },
];

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
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = async () => {
    const [agents, models, prices] = await Promise.all([
      api.get<ResolvedAgentConfig[]>("/settings/agents"),
      api.get<ProviderModels[]>("/settings/models"),
      api.get<PricingInfo[]>("/settings/pricing"),
    ]);
    setConfigs(agents);
    setKnownModels(models);
    setPricing(prices);
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
        Override the provider and model for each agent. Changes take effect on the next pipeline run.
      </p>

      {AGENT_GROUPS.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.label}
          </h3>
          <div className="space-y-3">
            {group.agents.map((agentName) => {
              const config = configs.find((c) => c.name === agentName);
              if (!config) return null;
              return (
                <AgentModelCard
                  key={agentName}
                  config={config}
                  knownModels={knownModels}
                  pricing={pricing}
                  saving={saving === agentName}
                  onSave={handleSave}
                  onReset={handleReset}
                />
              );
            })}
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
  saving,
  onSave,
  onReset,
}: {
  config: ResolvedAgentConfig;
  knownModels: ProviderModels[];
  pricing: PricingInfo[];
  saving: boolean;
  onSave: (name: string, provider: string, model: string) => void;
  onReset: (name: string) => void;
}) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);

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

      <div className="mt-1.5">
        {pricingInfo ? (
          <span className="text-[11px] text-muted-foreground">
            ${pricingInfo.input} input / ${pricingInfo.output} output per 1M tokens
          </span>
        ) : (
          <span className="text-[11px] text-amber-400">Pricing not configured</span>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/60 mt-1.5">{config.description}</p>
    </div>
  );
}
