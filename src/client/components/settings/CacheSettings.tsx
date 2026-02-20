import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { CacheMultiplierInfo } from "../../../shared/types.ts";

export function CacheSettings() {
  const [cacheMultipliers, setCacheMultipliers] = useState<CacheMultiplierInfo[]>([]);

  const refresh = async () => {
    const data = await api.get<CacheMultiplierInfo[]>("/settings/cache-multipliers");
    setCacheMultipliers(data);
  };

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  async function handleOverride(provider: string, create: number, read: number) {
    await api.put(`/settings/cache-multipliers/${provider}`, { create, read });
    await refresh();
  }

  async function handleReset(provider: string) {
    await api.delete(`/settings/cache-multipliers/${provider}`);
    await refresh();
  }

  if (cacheMultipliers.length === 0) {
    return <p className="text-sm text-zinc-500">Loading cache multipliers...</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        Multipliers applied to input price for cache token billing. These are per-provider settings.
      </p>

      <div className="space-y-3">
        {cacheMultipliers.map((cm) => (
          <CacheMultiplierCard
            key={cm.provider}
            info={cm}
            onOverride={handleOverride}
            onReset={handleReset}
          />
        ))}
      </div>
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
