import { useState } from "react";
import { ChatWindow } from "../chat/ChatWindow.tsx";
import { useChatStore } from "../../stores/chatStore.ts";

export function MainPanel() {
  const activeChat = useChatStore((s) => s.activeChat);
  const [activeTab, setActiveTab] = useState<"chat" | "preview">("chat");

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
          onClick={() => setActiveTab("preview")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "preview"
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

      {/* Content */}
      {activeTab === "chat" ? (
        <ChatWindow />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-500 text-sm">Preview will appear here when agents generate code.</p>
        </div>
      )}
    </main>
  );
}
