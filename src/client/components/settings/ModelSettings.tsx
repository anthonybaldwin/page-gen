import { useEffect, useState, useRef } from "react";
import { api } from "../../lib/api.ts";
import type { ResolvedAgentConfig, ModelPricing } from "../../../shared/types.ts";

const AGENT_GROUPS: { label: string; agents: string[] }[] = [
  { label: "Planning", agents: ["orchestrator", "research", "architect"] },
  { label: "Development", agents: ["frontend-dev", "backend-dev", "styling"] },
  { label: "Quality", agents: ["testing", "code-review", "qa", "security"] },
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

  async function handleSave(name: string, provider: string, model: string, customPricing?: { input: number; output: number }) {
    setSaving(name);
    try {
      if (customPricing) {
        await api.put(`/settings/pricing/${model}`, customPricing);
      }
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

  async function handlePricingOverride(model: string, input: number, output: number) {
    await api.put(`/settings/pricing/${model}`, { input, output });
    await refresh();
  }

  async function handlePricingReset(model: string) {
    await api.delete(`/settings/pricing/${model}`);
    await refresh();
  }

  if (configs.length === 0) {
    return <p className="text-sm text-zinc-500">Loading agent configs...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Override the provider and model for each agent. Changes take effect on the next pipeline run.
      </p>

      {AGENT_GROUPS.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
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
                  onPricingOverride={handlePricingOverride}
                  onPricingReset={handlePricingReset}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelSelector({
  provider,
  model,
  onChange,
  knownModels,
  pricing,
}: {
  provider: string;
  model: string;
  onChange: (model: string) => void;
  knownModels: ProviderModels[];
  pricing: PricingInfo[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(model);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearch(model);
  }, [model]);

  const providerModels = knownModels.find((p) => p.provider === provider)?.models || [];
  const filtered = providerModels.filter((m) =>
    m.id.toLowerCase().includes(search.toLowerCase())
  );
  const exactMatch = providerModels.some((m) => m.id === search);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch(model);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [model]);

  function formatPrice(p: { input: number; output: number }) {
    return `$${p.input}/$${p.output}`;
  }

  function getPricingForModel(modelId: string): { input: number; output: number } | null {
    const info = pricing.find((p) => p.model === modelId);
    if (info) return { input: info.input, output: info.output };
    const known = providerModels.find((m) => m.id === modelId);
    return known?.pricing || null;
  }

  return (
    <div className="relative flex-1" ref={containerRef}>
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
        placeholder="Search or type model ID..."
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded shadow-xl max-h-48 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id);
                setSearch(m.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 flex items-center justify-between ${
                m.id === model ? "bg-zinc-700/50 text-white" : "text-zinc-300"
              }`}
            >
              <span>{m.id}</span>
              {m.pricing && (
                <span className="text-zinc-500 ml-2">{formatPrice(m.pricing)}</span>
              )}
            </button>
          ))}
          {!exactMatch && search.trim() && (
            <button
              onClick={() => {
                onChange(search.trim());
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 text-amber-400 border-t border-zinc-700"
            >
              Use custom model: <span className="font-medium">{search.trim()}</span>
              {(() => {
                const p = getPricingForModel(search.trim());
                return p ? (
                  <span className="text-zinc-500 ml-2">{formatPrice(p)}</span>
                ) : (
                  <span className="text-amber-500 ml-2">(pricing required)</span>
                );
              })()}
            </button>
          )}
          {filtered.length === 0 && (exactMatch || !search.trim()) && (
            <div className="px-3 py-2 text-xs text-zinc-500">No models found</div>
          )}
        </div>
      )}
    </div>
  );
}

function PricingDisplay({
  model,
  pricing,
  customInput,
  customOutput,
  onCustomInputChange,
  onCustomOutputChange,
  onOverride,
  onReset,
}: {
  model: string;
  pricing: PricingInfo[];
  customInput: string;
  customOutput: string;
  onCustomInputChange: (v: string) => void;
  onCustomOutputChange: (v: string) => void;
  onOverride: (model: string, input: number, output: number) => void;
  onReset: (model: string) => void;
}) {
  const info = pricing.find((p) => p.model === model);
  const [editing, setEditing] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");

  useEffect(() => {
    setEditing(false);
  }, [model]);

  // No pricing info — requires configuration
  if (!info) {
    return (
      <div className="mt-1.5">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
            Pricing required
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-zinc-500">Input $/1M:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              className="w-16 rounded bg-zinc-800 border border-amber-600/50 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-amber-500"
              placeholder="0.00"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-zinc-500">Output $/1M:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={customOutput}
              onChange={(e) => onCustomOutputChange(e.target.value)}
              className="w-16 rounded bg-zinc-800 border border-amber-600/50 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-amber-500"
              placeholder="0.00"
            />
          </div>
        </div>
      </div>
    );
  }

  // Known or configured model — show pricing read-only
  if (!editing) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[11px] text-zinc-500">
          ${info.input} input / ${info.output} output per 1M tokens
        </span>
        {info.isOverridden && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400">
            override
          </span>
        )}
        <button
          onClick={() => {
            setEditInput(String(info.input));
            setEditOutput(String(info.output));
            setEditing(true);
          }}
          className="text-zinc-300 hover:text-white transition-colors ml-0.5"
          title="Edit pricing"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-9.793 9.793a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168L12.146.854zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5z" />
          </svg>
        </button>
      </div>
    );
  }

  // Editing mode for known models
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex items-center gap-1">
        <label className="text-[10px] text-zinc-500">Input $/1M:</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={editInput}
          onChange={(e) => setEditInput(e.target.value)}
          className="w-16 rounded bg-zinc-800 border border-zinc-600 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="flex items-center gap-1">
        <label className="text-[10px] text-zinc-500">Output $/1M:</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={editOutput}
          onChange={(e) => setEditOutput(e.target.value)}
          className="w-16 rounded bg-zinc-800 border border-zinc-600 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-blue-500"
        />
      </div>
      <button
        onClick={() => {
          const inp = parseFloat(editInput);
          const out = parseFloat(editOutput);
          if (!isNaN(inp) && !isNaN(out) && inp >= 0 && out >= 0) {
            onOverride(model, inp, out);
            setEditing(false);
          }
        }}
        className="text-[10px] text-blue-400 hover:text-blue-300"
      >
        Save
      </button>
      <button
        onClick={() => {
          if (info.isOverridden && info.isKnown) {
            onReset(model);
          }
          setEditing(false);
        }}
        className="text-[10px] text-zinc-500 hover:text-zinc-300"
      >
        Cancel
      </button>
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
  onPricingOverride,
  onPricingReset,
}: {
  config: ResolvedAgentConfig;
  knownModels: ProviderModels[];
  pricing: PricingInfo[];
  saving: boolean;
  onSave: (name: string, provider: string, model: string, customPricing?: { input: number; output: number }) => void;
  onReset: (name: string) => void;
  onPricingOverride: (model: string, input: number, output: number) => void;
  onPricingReset: (model: string) => void;
}) {
  const [provider, setProvider] = useState(config.provider);
  const [model, setModel] = useState(config.model);
  const [customInput, setCustomInput] = useState("");
  const [customOutput, setCustomOutput] = useState("");

  useEffect(() => {
    setProvider(config.provider);
    setModel(config.model);
    setCustomInput("");
    setCustomOutput("");
  }, [config]);

  const isDirty = provider !== config.provider || model !== config.model;
  const pricingInfo = pricing.find((p) => p.model === model);
  const needsPricing = !pricingInfo && isDirty;

  const customPricingValid =
    customInput !== "" &&
    customOutput !== "" &&
    !isNaN(parseFloat(customInput)) &&
    !isNaN(parseFloat(customOutput)) &&
    parseFloat(customInput) >= 0 &&
    parseFloat(customOutput) >= 0;

  const canSave = isDirty && (!needsPricing || customPricingValid);

  function handleSaveClick() {
    if (!canSave) return;
    const customPricing = needsPricing && customPricingValid
      ? { input: parseFloat(customInput), output: parseFloat(customOutput) }
      : undefined;
    onSave(config.name, provider, model, customPricing);
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{config.displayName}</span>
          {config.isOverridden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              custom
            </span>
          )}
        </div>
        {config.isOverridden && (
          <button
            onClick={() => onReset(config.name)}
            disabled={saving}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <ModelSelector
          provider={provider}
          model={model}
          onChange={(m) => {
            setModel(m);
            setCustomInput("");
            setCustomOutput("");
          }}
          knownModels={knownModels}
          pricing={pricing}
        />

        {isDirty && (
          <button
            onClick={handleSaveClick}
            disabled={saving || !canSave}
            className={`rounded px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
              needsPricing && !customPricingValid ? "bg-zinc-600" : needsPricing ? "bg-amber-600 hover:bg-amber-500" : "bg-blue-600 hover:bg-blue-500"
            }`}
          >
            {saving ? "..." : "Save"}
          </button>
        )}
      </div>

      <PricingDisplay
        model={model}
        pricing={pricing}
        customInput={customInput}
        customOutput={customOutput}
        onCustomInputChange={setCustomInput}
        onCustomOutputChange={setCustomOutput}
        onOverride={onPricingOverride}
        onReset={onPricingReset}
      />

      <p className="text-[11px] text-zinc-600 mt-1.5">{config.description}</p>
    </div>
  );
}
