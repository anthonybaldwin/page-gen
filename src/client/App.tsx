import { useEffect, useState, useRef, useCallback } from "react";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { ChatWindow } from "./components/chat/ChatWindow.tsx";
import { AgentStatusPanel } from "./components/chat/AgentStatusPanel.tsx";
import { LivePreview } from "./components/preview/LivePreview.tsx";
import { FileExplorer } from "./components/layout/FileExplorer.tsx";
import { ApiKeySetup } from "./components/settings/ApiKeySetup.tsx";
import { useSettingsStore } from "./stores/settingsStore.ts";
import { useChatStore } from "./stores/chatStore.ts";

const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_RATIO = 0.5; // max 50% of viewport
const DEFAULT_CHAT_WIDTH = 384; // w-96
const STORAGE_KEY = "chat-pane-width";

function getInitialWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (parsed >= MIN_CHAT_WIDTH && parsed <= window.innerWidth * MAX_CHAT_RATIO) {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return DEFAULT_CHAT_WIDTH;
}

export function App() {
  const { hasKeys, keysReady, loadKeys } = useSettingsStore();
  const [showSetup, setShowSetup] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeChat = useChatStore((s) => s.activeChat);
  const [chatWidth, setChatWidth] = useState(getInitialWidth);
  const isDragging = useRef(false);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (keysReady && !hasKeys) setShowSetup(true);
  }, [keysReady, hasKeys]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startWidth = chatWidth;

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const delta = ev.clientX - startX;
      const maxWidth = window.innerWidth * MAX_CHAT_RATIO;
      const newWidth = Math.max(MIN_CHAT_WIDTH, Math.min(maxWidth, startWidth + delta));
      setChatWidth(newWidth);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      try { localStorage.setItem(STORAGE_KEY, String(Math.round(chatWidth))); } catch { /* ignore */ }
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [chatWidth]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(Math.round(chatWidth))); } catch { /* ignore */ }
  }, [chatWidth]);

  return (
    <div className="flex h-full bg-background text-foreground">
      {showSetup && !hasKeys && (
        <ApiKeySetup onComplete={() => setShowSetup(false)} />
      )}

      {/* Left: Sidebar */}
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />

      {/* Chat column — resizable */}
      <div className="flex flex-col border-r border-border min-h-0" style={{ width: chatWidth }}>
        <ChatWindow />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-1.5 cursor-col-resize bg-border/50 hover:bg-primary/40 active:bg-primary/60 transition-colors flex-shrink-0"
        role="separator"
        aria-orientation="vertical"
      />

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
