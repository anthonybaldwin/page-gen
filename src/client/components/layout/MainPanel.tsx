import { useState, useRef, useEffect } from "react";
import { ChatWindow } from "../chat/ChatWindow.tsx";
import { LivePreview } from "../preview/LivePreview.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { useProjectStore } from "../../stores/projectStore.ts";
import { api } from "../../lib/api.ts";
import { onWsMessage, connectWebSocket } from "../../lib/ws.ts";
import type { FileNode } from "../../../shared/types.ts";

export function MainPanel() {
  const activeChat = useChatStore((s) => s.activeChat);
  const activeProject = useProjectStore((s) => s.activeProject);
  const [activeTab, setActiveTab] = useState<"chat" | "preview">("chat");
  const [hasFiles, setHasFiles] = useState(false);
  const hasOpenedPreview = useRef(false);
  if (activeTab === "preview") hasOpenedPreview.current = true;

  // Check if project has files
  useEffect(() => {
    if (!activeProject) {
      setHasFiles(false);
      return;
    }
    api
      .get<FileNode[]>(`/files/tree/${activeProject.id}`)
      .then((tree) => setHasFiles(tree.length > 0))
      .catch(() => setHasFiles(false));
  }, [activeProject]);

  // Re-check files when agents complete
  useEffect(() => {
    connectWebSocket();
    const unsub = onWsMessage((msg) => {
      if (
        msg.type === "agent_status" &&
        (msg.payload as { status: string }).status === "completed" &&
        activeProject
      ) {
        api
          .get<FileNode[]>(`/files/tree/${activeProject.id}`)
          .then((tree) => setHasFiles(tree.length > 0))
          .catch(() => {});
      }
    });
    return unsub;
  }, [activeProject]);

  // Force switch to chat if preview becomes unavailable
  useEffect(() => {
    if (!hasFiles && activeTab === "preview") setActiveTab("chat");
  }, [hasFiles, activeTab]);

  return (
    <main className="flex-1 flex flex-col min-w-0">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-800 bg-zinc-900">
        <button
          onClick={() => setActiveTab("chat")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "chat"
              ? "text-white border-b-2 border-blue-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => hasFiles && setActiveTab("preview")}
          disabled={!hasFiles}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            !hasFiles
              ? "text-zinc-700 cursor-not-allowed"
              : activeTab === "preview"
                ? "text-white border-b-2 border-blue-500"
                : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Preview
        </button>
        {activeChat && (
          <div className="flex-1 flex items-center justify-end px-4">
            <span className="text-xs text-zinc-500">{activeChat.title}</span>
          </div>
        )}
      </div>

      {/* Content — both panels stay mounted; hidden one uses display:none to preserve state */}
      <div className={`flex-1 flex flex-col min-h-0 ${activeTab !== "chat" ? "hidden" : ""}`}>
        <ChatWindow />
      </div>
      <div className={`flex-1 flex flex-col min-h-0 ${activeTab !== "preview" ? "hidden" : ""}`}>
        {hasOpenedPreview.current && <LivePreview />}
      </div>
    </main>
  );
}
