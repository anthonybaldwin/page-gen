import { useEffect, useRef, useState } from "react";
import { MessageList } from "./MessageList.tsx";
import { MessageInput } from "./MessageInput.tsx";
import { AgentStatusPanel } from "./AgentStatusPanel.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { api } from "../../lib/api.ts";
import type { Message } from "../../../shared/types.ts";
import { nanoid } from "nanoid";

export function ChatWindow() {
  const { activeChat, messages, setMessages, addMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChat) return;
    setError(null);
    api
      .get<Message[]>(`/messages?chatId=${activeChat.id}`)
      .then(setMessages)
      .catch((err) => {
        console.error("[chat] Failed to load messages:", err);
        setError("Failed to load messages. Is the backend server running?");
      });
  }, [activeChat, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(content: string) {
    if (!activeChat) return;
    setError(null);

    // Optimistic: show the message immediately before API call
    const optimisticMsg: Message = {
      id: nanoid(),
      chatId: activeChat.id,
      role: "user",
      content,
      agentName: null,
      metadata: null,
      createdAt: Date.now(),
    };
    addMessage(optimisticMsg);

    // Persist to backend
    try {
      await api.post<Message>("/messages", {
        chatId: activeChat.id,
        role: "user",
        content,
      });
    } catch (err) {
      console.error("[chat] Failed to save message:", err);
      setError("Failed to save message. Check that the backend server is running (bun run dev).");
      // Message stays visible in UI — user can see what they typed
    }

    // Trigger agent orchestration
    try {
      await api.post("/agents/run", {
        chatId: activeChat.id,
        message: content,
      });
    } catch {
      // Agent orchestration may fail for various reasons — not critical for message display
    }
  }

  if (!activeChat) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-zinc-500 text-sm">Select or create a chat to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <AgentStatusPanel />
      {error && (
        <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 ml-2">
            Dismiss
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} />
    </div>
  );
}
