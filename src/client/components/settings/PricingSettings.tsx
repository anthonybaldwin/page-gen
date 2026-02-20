import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { ModelPricing, CacheMultiplierInfo } from "../../../shared/types.ts";

interface ProviderModels {
  provider: string;
  models: Array<{ id: string; pricing: { input: number; output: number } | null }>;
}

interface PricingInfo extends ModelPricing {
  model: string;
}

export function PricingSettings() {
  const [knownModels, setKnownModels] = useState<ProviderModels[]>([]);
  const [pricing, setPricing] = useState<PricingInfo[]>([]);
  const [cacheMultipliers, setCacheMultipliers] = useState<CacheMultiplierInfo[]>([]);

  const refresh = async () => {
    const [models, prices, cache] = await Promise.all([
      api.get<ProviderModels[]>("/settings/models"),
      api.get<PricingInfo[]>("/settings/pricing"),
      api.get<CacheMultiplierInfo[]>("/settings/cache-multipliers"),
    ]);
    setKnownModels(models);
    setPricing(prices);
    setCacheMultipliers(cache);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  async function handlePricingOverride(model: string, input: number, output: number, provider?: string) {
    await api.put(`/settings/pricing/${model}`, { input, output, ...(provider ? { provider } : {}) });
    await refresh();
  }

  async function handlePricingReset(model: string) {
    await api.delete(`/settings/pricing/${model}`);
    await refresh();
  }

  async function handleCacheOverride(provider: string, create: number, read: number) {
    await api.put(`/settings/cache-multipliers/${provider}`, { create, read });
    await refresh();
  }

  async function handleCacheReset(provider: string) {
    await api.delete(`/settings/cache-multipliers/${provider}`);
    await refresh();
  }

  if (knownModels.length === 0) {
    return <p className="text-sm text-zinc-500">Loading models...</p>;
  }

  // Collect all known model IDs so we can identify custom-only pricing entries
  const knownModelIds = new Set(knownModels.flatMap((g) => g.models.map((m) => m.id)));
  const customPricing = pricing.filter((p) => !knownModelIds.has(p.model));

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Override per-model token pricing and cache multipliers.
      </p>

      {/* Cache Multipliers — prominent at top */}
      {cacheMultipliers.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            Cache Token Multipliers
          </h3>
          <p className="text-[11px] text-zinc-600 mb-2">
            Multipliers applied to input price for cache token billing, per provider.
          </p>
          <div className="space-y-2">
            {cacheMultipliers.map((cm) => (
              <CacheMultiplierCard
                key={cm.provider}
                info={cm}
                onOverride={handleCacheOverride}
                onReset={handleCacheReset}
              />
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800" />

      {/* Add Custom Model */}
      <AddCustomModelForm onAdd={(model, input, output, provider) => handlePricingOverride(model, input, output, provider)} existingModels={knownModelIds} />

      {/* Model Pricing by Provider */}
      {knownModels.map((group) => (
        <div key={group.provider}>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            {group.provider}
          </h3>
          <div className="space-y-2">
            {group.models.map((model) => {
              const info = pricing.find((p) => p.model === model.id);
              return (
                <ModelPricingCard
                  key={model.id}
                  modelId={model.id}
                  defaultPricing={model.pricing}
                  pricingInfo={info || null}
                  onOverride={handlePricingOverride}
                  onReset={handlePricingReset}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Custom models (not in any known provider) */}
      {customPricing.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            Custom Models
          </h3>
          <div className="space-y-2">
            {customPricing.map((p) => (
              <ModelPricingCard
                key={p.model}
                modelId={p.model}
                defaultPricing={null}
                pricingInfo={p}
                onOverride={handlePricingOverride}
                onReset={handlePricingReset}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PROVIDERS = ["anthropic", "openai", "google"];

function AddCustomModelForm({
  onAdd,
  existingModels,
}: {
  onAdd: (model: string, input: number, output: number, provider: string) => void;
  existingModels: Set<string>;
}) {
  const [provider, setProvider] = useState(PROVIDERS[0]!);
  const [modelId, setModelId] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [error, setError] = useState("");

  function handleSubmit() {
    const id = modelId.trim();
    if (!id) { setError("Model ID required"); return; }
    if (existingModels.has(id)) { setError("Model already exists — edit it above"); return; }
    const inp = parseFloat(inputPrice);
    const out = parseFloat(outputPrice);
    if (isNaN(inp) || isNaN(out) || inp < 0 || out < 0) { setError("Valid pricing required"); return; }
    setError("");
    onAdd(id, inp, out, provider);
    setModelId("");
    setInputPrice("");
    setOutputPrice("");
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
      <h4 className="text-xs font-medium text-zinc-300 mb-2">Add Custom Model</h4>
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-[10px] text-zinc-500 block mb-0.5">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] text-zinc-500 block mb-0.5">Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => { setModelId(e.target.value); setError(""); }}
            placeholder="e.g. my-custom-model-v1"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-zinc-500 block mb-0.5">Input $/1M</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={inputPrice}
            onChange={(e) => { setInputPrice(e.target.value); setError(""); }}
            placeholder="0.00"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-zinc-500 block mb-0.5">Output $/1M</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={outputPrice}
            onChange={(e) => { setOutputPrice(e.target.value); setError(""); }}
            placeholder="0.00"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <button
          onClick={handleSubmit}
          className="rounded px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
        >
          Add
        </button>
      </div>
      {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function ModelPricingCard({
  modelId,
  defaultPricing,
  pricingInfo,
  onOverride,
  onReset,
}: {
  modelId: string;
  defaultPricing: { input: number; output: number } | null;
  pricingInfo: (PricingInfo) | null;
  onOverride: (model: string, input: number, output: number) => void;
  onReset: (model: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");

  const input = pricingInfo?.input ?? defaultPricing?.input;
  const output = pricingInfo?.output ?? defaultPricing?.output;
  const hasPricing = input != null && output != null;

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{modelId}</span>
          {pricingInfo?.isOverridden && pricingInfo.isKnown && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              override
            </span>
          )}
          {pricingInfo && !pricingInfo.isKnown && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
              custom
            </span>
          )}
        </div>
        {pricingInfo?.isOverridden && pricingInfo.isKnown && (
          <button
            onClick={() => onReset(modelId)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Reset
          </button>
        )}
        {pricingInfo && !pricingInfo.isKnown && (
          <button
            onClick={() => onReset(modelId)}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          {hasPricing ? (
            <span className="text-[11px] text-zinc-500">
              ${input} input / ${output} output per 1M tokens
            </span>
          ) : (
            <span className="text-[11px] text-amber-400">Pricing not configured</span>
          )}
          <button
            onClick={() => {
              setEditInput(String(input ?? ""));
              setEditOutput(String(output ?? ""));
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
      ) : (
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
                onOverride(modelId, inp, out);
                setEditing(false);
              }
            }}
            className="text-[10px] text-blue-400 hover:text-blue-300"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function CacheMultiplierCard({
  info,
  onOverride,
  onReset,
}: {
  info: CacheMultiplierInfo;
  onOverride: (provider: string, create: number, read: number) => void;
  onReset: (provider: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editCreate, setEditCreate] = useState("");
  const [editRead, setEditRead] = useState("");

  return (
    <div className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{info.provider}</span>
          {info.isOverridden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
              override
            </span>
          )}
        </div>
        {info.isOverridden && (
          <button
            onClick={() => onReset(info.provider)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {!editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">
            Create: {info.create}x &middot; Read: {info.read}x
          </span>
          <button
            onClick={() => {
              setEditCreate(String(info.create));
              setEditRead(String(info.read));
              setEditing(true);
            }}
            className="text-zinc-300 hover:text-white transition-colors ml-0.5"
            title="Edit multipliers"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.146.854a.5.5 0 0 1 .708 0l2.292 2.292a.5.5 0 0 1 0 .708l-9.793 9.793a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168L12.146.854zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5z" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-zinc-500">Create:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={editCreate}
              onChange={(e) => setEditCreate(e.target.value)}
              className="w-16 rounded bg-zinc-800 border border-zinc-600 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-zinc-500">Read:</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={editRead}
              onChange={(e) => setEditRead(e.target.value)}
              className="w-16 rounded bg-zinc-800 border border-zinc-600 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={() => {
              const c = parseFloat(editCreate);
              const r = parseFloat(editRead);
              if (!isNaN(c) && !isNaN(r) && c >= 0 && r >= 0) {
                onOverride(info.provider, c, r);
                setEditing(false);
              }
            }}
            className="text-[10px] text-blue-400 hover:text-blue-300"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
