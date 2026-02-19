import { useEffect, useState } from "react";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { ChatWindow } from "./components/chat/ChatWindow.tsx";
import { AgentStatusPanel } from "./components/chat/AgentStatusPanel.tsx";
import { LivePreview } from "./components/preview/LivePreview.tsx";
import { FileExplorer } from "./components/layout/FileExplorer.tsx";
import { ApiKeySetup } from "./components/settings/ApiKeySetup.tsx";
import { useSettingsStore } from "./stores/settingsStore.ts";
import { useChatStore } from "./stores/chatStore.ts";

export function App() {
  const { hasKeys, keysReady, loadKeys } = useSettingsStore();
  const [showSetup, setShowSetup] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeChat = useChatStore((s) => s.activeChat);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (keysReady && !hasKeys) setShowSetup(true);
  }, [keysReady, hasKeys]);

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      {showSetup && !hasKeys && (
        <ApiKeySetup onComplete={() => setShowSetup(false)} />
      )}

      {/* Left: Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {/* Chat column — narrow, fixed width */}
      <div className="w-96 flex flex-col border-r border-zinc-800 min-h-0">
        <ChatWindow />
      </div>

      {/* Preview column — fills remaining space */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        <AgentStatusPanel chatId={activeChat?.id ?? null} />
        <LivePreview />
      </div>

      {/* Right: File explorer */}
      <FileExplorer />
    </div>
  );
}
