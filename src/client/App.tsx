import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { MainPanel } from "./components/layout/MainPanel.tsx";
import { FileExplorer } from "./components/layout/FileExplorer.tsx";
import { ApiKeySetup } from "./components/settings/ApiKeySetup.tsx";
import { useSettingsStore } from "./stores/settingsStore.ts";

export function App() {
  const { hasKeys, loadKeys } = useSettingsStore();
  const [showSetup, setShowSetup] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (!hasKeys) setShowSetup(true);
  }, [hasKeys]);

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      {showSetup && !hasKeys && (
        <ApiKeySetup onComplete={() => setShowSetup(false)} />
      )}

      {/* Left: Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {/* Center: Main panel */}
      <MainPanel />

      {/* Right: File explorer */}
      <FileExplorer />
    </div>
  );
}
