import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { useSettingsStore } from "../../stores/settingsStore.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.tsx";
import { Pencil, Info } from "lucide-react";
import type { ModelPricing, CacheMultiplierInfo } from "../../../shared/types.ts";
import { CATEGORY_LABELS, CATEGORY_ORDER, type ModelCategory } from "../../../shared/providers.ts";

interface ProviderModels {
  provider: string;
  models: Array<{ id: string; pricing: { input: number; output: number } | null; category?: string }>;
}

interface PricingInfo extends ModelPricing {
  model: string;
}

export function PricingSettings() {
  const keysVersion = useSettingsStore((s) => s.keysVersion);
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
  }, [keysVersion]);

  async function handlePricingOverride(model: string, input: number, output: number, provider?: string, category?: string) {
    await api.put(`/settings/pricing/${model}`, { input, output, ...(provider ? { provider } : {}), ...(category ? { category } : {}) });
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
    return <p className="text-sm text-muted-foreground">Loading models...</p>;
  }

  const knownModelIds = new Set(knownModels.flatMap((g) => g.models.map((m) => m.id)));
  const customPricing = pricing.filter((p) => !knownModelIds.has(p.model));

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Override per-model token pricing and cache multipliers.
      </p>

      {cacheMultipliers.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Cache Token Multipliers
          </h3>
          <p className="text-[11px] text-muted-foreground/60 mb-2">
            Multipliers applied to input price for cache token billing, per provider.
          </p>
          <div className="grid grid-cols-2 gap-2">
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

      <div className="border-t border-border" />

      <AddCustomModelForm onAdd={(model, input, output, provider, category) => handlePricingOverride(model, input, output, provider, category)} existingModels={knownModelIds} knownModels={knownModels} />

      {knownModels.map((group) => (
        <div key={group.provider}>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {group.provider}
          </h3>
          <div className="grid grid-cols-2 gap-2">
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

      {customPricing.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Custom Models
          </h3>
          <div className="grid grid-cols-2 gap-2">
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

function AddCustomModelForm({
  onAdd,
  existingModels,
  knownModels,
}: {
  onAdd: (model: string, input: number, output: number, provider: string, category?: string) => void;
  existingModels: Set<string>;
  knownModels: ProviderModels[];
}) {
  const availableProviders = knownModels.map((p) => p.provider);
  const [provider, setProvider] = useState(availableProviders[0] ?? "");
  const [modelId, setModelId] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [category, setCategory] = useState<ModelCategory>("text");
  const [error, setError] = useState("");

  function handleSubmit() {
    const id = modelId.trim();
    if (!id) { setError("Model ID required"); return; }
    if (existingModels.has(id)) { setError("Model already exists — edit it above"); return; }
    const inp = parseFloat(inputPrice);
    const out = parseFloat(outputPrice);
    if (isNaN(inp) || isNaN(out) || inp < 0 || out < 0) { setError("Valid pricing required"); return; }
    setError("");
    onAdd(id, inp, out, provider, category);
    setModelId("");
    setInputPrice("");
    setOutputPrice("");
    setCategory("text");
  }

  return (
    <div className="rounded-lg bg-muted/50 border border-border/50 p-3">
      <h4 className="text-xs font-medium text-muted-foreground mb-2">Add Custom Model</h4>
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Provider</label>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="h-8 text-xs w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableProviders.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] text-muted-foreground block mb-0.5">Model ID</label>
          <Input
            type="text"
            value={modelId}
            onChange={(e) => { setModelId(e.target.value); setError(""); }}
            placeholder="e.g. my-custom-model-v1"
            className="h-8 text-xs"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-muted-foreground block mb-0.5">Input $/1M</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={inputPrice}
            onChange={(e) => { setInputPrice(e.target.value); setError(""); }}
            placeholder="0.00"
            className="h-8 text-xs"
          />
        </div>
        <div className="w-20">
          <label className="text-[10px] text-muted-foreground block mb-0.5">Output $/1M</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={outputPrice}
            onChange={(e) => { setOutputPrice(e.target.value); setError(""); }}
            placeholder="0.00"
            className="h-8 text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Category</label>
          <Select value={category} onValueChange={(val) => setCategory(val as ModelCategory)}>
            <SelectTrigger className="h-8 text-xs w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((cat) => (
                <SelectItem key={cat} value={cat} className="text-xs">{CATEGORY_LABELS[cat]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={handleSubmit} className="h-8 text-xs">
          Add
        </Button>
      </div>
      {category === "reasoning" && (
        <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
          <Info className="h-3 w-3 shrink-0" />
          Reasoning models use output tokens for chain-of-thought. A minimum output token floor is applied automatically.
        </p>
      )}
      {error && <p className="text-[10px] text-destructive mt-1">{error}</p>}
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
    <div className="rounded-lg bg-muted/50 border border-border/50 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-xs font-medium text-foreground truncate">{modelId}</span>
          {pricingInfo?.isOverridden && pricingInfo.isKnown && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              override
            </span>
          )}
          {pricingInfo && !pricingInfo.isKnown && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
              custom
            </span>
          )}
          {pricingInfo?.category && pricingInfo.category !== "text" && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              pricingInfo.category === "reasoning" ? "bg-amber-500/20 text-amber-400"
                : pricingInfo.category === "code" ? "bg-blue-500/20 text-blue-400"
                : "bg-muted text-muted-foreground"
            }`}>
              {CATEGORY_LABELS[pricingInfo.category as ModelCategory] ?? pricingInfo.category}
            </span>
          )}
        </div>
        {pricingInfo?.isOverridden && pricingInfo.isKnown && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReset(modelId)}
            className="h-6 px-2 text-xs text-muted-foreground"
          >
            Reset
          </Button>
        )}
        {pricingInfo && !pricingInfo.isKnown && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReset(modelId)}
            className="h-6 px-2 text-xs text-destructive"
          >
            Remove
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          {hasPricing ? (
            <span className="text-[11px] text-muted-foreground">
              ${input} input / ${output} output per 1M tokens
            </span>
          ) : (
            <span className="text-[11px] text-amber-400">Pricing not configured</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setEditInput(String(input ?? ""));
              setEditOutput(String(output ?? ""));
              setEditing(true);
            }}
            className="h-5 w-5 text-muted-foreground hover:text-foreground ml-0.5"
            title="Edit pricing"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Input $/1M:</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editInput}
              onChange={(e) => setEditInput(e.target.value)}
              className="w-16 h-7 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Output $/1M:</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editOutput}
              onChange={(e) => setEditOutput(e.target.value)}
              className="w-16 h-7 text-[11px]"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const inp = parseFloat(editInput);
              const out = parseFloat(editOutput);
              if (!isNaN(inp) && !isNaN(out) && inp >= 0 && out >= 0) {
                onOverride(modelId, inp, out);
                setEditing(false);
              }
            }}
            className="h-6 px-2 text-[10px] text-primary"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            className="h-6 px-2 text-[10px] text-muted-foreground"
          >
            Cancel
          </Button>
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
    <div className="rounded-lg bg-muted/50 border border-border/50 p-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{info.provider}</span>
          {info.isOverridden && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
              override
            </span>
          )}
        </div>
        {info.isOverridden && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReset(info.provider)}
            className="h-6 px-2 text-xs text-muted-foreground"
          >
            Reset
          </Button>
        )}
      </div>

      {!editing ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            Create: {info.create}x &middot; Read: {info.read}x
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setEditCreate(String(info.create));
              setEditRead(String(info.read));
              setEditing(true);
            }}
            className="h-5 w-5 text-muted-foreground hover:text-foreground ml-0.5"
            title="Edit multipliers"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Create:</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editCreate}
              onChange={(e) => setEditCreate(e.target.value)}
              className="w-16 h-7 text-[11px]"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-muted-foreground">Read:</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editRead}
              onChange={(e) => setEditRead(e.target.value)}
              className="w-16 h-7 text-[11px]"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const c = parseFloat(editCreate);
              const r = parseFloat(editRead);
              if (!isNaN(c) && !isNaN(r) && c >= 0 && r >= 0) {
                onOverride(info.provider, c, r);
                setEditing(false);
              }
            }}
            className="h-6 px-2 text-[10px] text-primary"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            className="h-6 px-2 text-[10px] text-muted-foreground"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
