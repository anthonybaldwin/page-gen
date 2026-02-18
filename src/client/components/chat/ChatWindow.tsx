import { useEffect, useRef } from "react";
import { MessageList } from "./MessageList.tsx";
import { MessageInput } from "./MessageInput.tsx";
import { AgentStatusPanel } from "./AgentStatusPanel.tsx";
import { useChatStore } from "../../stores/chatStore.ts";
import { api } from "../../lib/api.ts";
import type { Message } from "../../../shared/types.ts";

export function ChatWindow() {
  const { activeChat, messages, setMessages, addMessage } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeChat) return;
    api.get<Message[]>(`/messages?chatId=${activeChat.id}`).then(setMessages).catch(console.error);
  }, [activeChat, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(content: string) {
    if (!activeChat) return;

    const userMsg = await api.post<Message>("/messages", {
      chatId: activeChat.id,
      role: "user",
      content,
    });
    addMessage(userMsg);

    // Trigger agent orchestration
    try {
      await api.post("/agents/run", {
        chatId: activeChat.id,
        message: content,
      });
    } catch {
      // Agent system not yet implemented - that's ok for now
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
      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>
      <MessageInput onSend={handleSend} />
    </div>
  );
}
