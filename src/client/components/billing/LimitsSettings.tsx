import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";

interface Limits {
  maxTokensPerChat: number;
  maxAgentCallsPerRun: number;
  maxCostPerDay: number;
  maxCostPerProject: number;
}

export function LimitsSettings() {
  const [limits, setLimits] = useState<Limits>({
    maxTokensPerChat: 500000,
    maxAgentCallsPerRun: 30,
    maxCostPerDay: 0,
    maxCostPerProject: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<{ limits: Limits }>("/settings")
      .then((res) => setLimits(res.limits))
      .catch(console.error);
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await api.put<{ limits: Limits }>("/settings/limits", limits);
      setLimits(res.limits);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("[limits] Failed to save:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Configure spending guardrails. Set to 0 for unlimited.
      </p>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Max tokens per chat
        </label>
        <input
          type="number"
          min={0}
          value={limits.maxTokensPerChat}
          onChange={(e) => setLimits((l) => ({ ...l, maxTokensPerChat: Number(e.target.value) }))}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-zinc-600 mt-1">Token ceiling per chat session (0 = unlimited)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Max agent calls per run
        </label>
        <input
          type="number"
          min={0}
          value={limits.maxAgentCallsPerRun}
          onChange={(e) => setLimits((l) => ({ ...l, maxAgentCallsPerRun: Number(e.target.value) }))}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-zinc-600 mt-1">Max agent invocations per pipeline run</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Max cost per day ($)
        </label>
        <input
          type="number"
          min={0}
          step={0.01}
          value={limits.maxCostPerDay}
          onChange={(e) => setLimits((l) => ({ ...l, maxCostPerDay: Number(e.target.value) }))}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-zinc-600 mt-1">Daily spending cap in USD (0 = unlimited)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Max cost per project ($)
        </label>
        <input
          type="number"
          min={0}
          step={0.01}
          value={limits.maxCostPerProject}
          onChange={(e) => setLimits((l) => ({ ...l, maxCostPerProject: Number(e.target.value) }))}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-zinc-600 mt-1">Per-project spending cap in USD (0 = unlimited)</p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
      >
        {saving ? "Saving..." : saved ? "Saved" : "Save Limits"}
      </button>
    </div>
  );
}
