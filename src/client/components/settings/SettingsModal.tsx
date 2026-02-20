import { useState } from "react";
import { ApiKeySettings } from "../billing/ApiKeySettings.tsx";
import { LimitsSettings } from "../billing/LimitsSettings.tsx";
import { ModelSettings } from "./ModelSettings.tsx";
import { PromptEditor } from "./PromptEditor.tsx";
import { ToolSettings } from "./ToolSettings.tsx";
import { CacheSettings } from "./CacheSettings.tsx";

type Tab = "keys" | "limits" | "models" | "cache" | "prompts" | "tools";

const TAB_LABELS: Record<Tab, string> = {
  keys: "API Keys",
  limits: "Limits",
  models: "Agents",
  cache: "Cache",
  prompts: "Prompts",
  tools: "Tools",
};

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("keys");

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Pinned header */}
      <div className="shrink-0 border-b border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-medium text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4">
          {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "text-white border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {activeTab === "keys" && <ApiKeySettings />}
        {activeTab === "limits" && <LimitsSettings />}
        {activeTab === "models" && <ModelSettings />}
        {activeTab === "cache" && <CacheSettings />}
        {activeTab === "prompts" && <PromptEditor />}
        {activeTab === "tools" && <ToolSettings />}
      </div>
    </div>
  );
}
