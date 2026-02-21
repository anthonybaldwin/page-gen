import { useEffect, useState, useRef, useCallback } from "react";
import { Sidebar } from "./components/layout/Sidebar.tsx";
import { ChatWindow } from "./components/chat/ChatWindow.tsx";
import { AgentStatusPanel } from "./components/chat/AgentStatusPanel.tsx";
import { LivePreview } from "./components/preview/LivePreview.tsx";
import { EditorPanel } from "./components/editor/EditorPanel.tsx";
import { FileExplorer } from "./components/layout/FileExplorer.tsx";
import { ApiKeySetup } from "./components/settings/ApiKeySetup.tsx";
import { useSettingsStore } from "./stores/settingsStore.ts";
import { useChatStore } from "./stores/chatStore.ts";
import { useProjectStore } from "./stores/projectStore.ts";
import { useFileStore } from "./stores/fileStore.ts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs.tsx";
import { X } from "lucide-react";

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
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeTab, setActiveTab, isDirty, openFilePath, closeFile } = useFileStore();
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

  // Close editor when switching projects
  useEffect(() => {
    closeFile();
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Content column — tabbed Preview / Editor */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "preview" | "editor")}
        className="flex-1 flex flex-col min-h-0 min-w-0"
      >
        <AgentStatusPanel chatId={activeChat?.id ?? null} />
        <div className="flex items-center border-b border-border bg-card shrink-0">
          <TabsList className="ml-auto mr-2 h-8 bg-transparent p-0 gap-0">
            <TabsTrigger
              value="preview"
              className="relative rounded-none border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none bg-transparent"
            >
              Preview
            </TabsTrigger>
            {openFilePath && (
              <TabsTrigger
                value="editor"
                className="relative rounded-none border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none bg-transparent gap-1.5"
              >
                {openFilePath.split("/").pop()}
                {isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                )}
                <button
                  type="button"
                  className="ml-1 rounded-sm opacity-50 hover:opacity-100 hover:bg-muted p-0.5 -mr-1"
                  onClick={(e) => { e.stopPropagation(); closeFile(); }}
                >
                  <X className="h-3 w-3" />
                </button>
              </TabsTrigger>
            )}
          </TabsList>
        </div>
        <TabsContent value="preview" forceMount className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
          <LivePreview />
        </TabsContent>
        <TabsContent value="editor" forceMount className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
          <EditorPanel />
        </TabsContent>
      </Tabs>

      {/* Right: File explorer */}
      <FileExplorer />
    </div>
  );
}
