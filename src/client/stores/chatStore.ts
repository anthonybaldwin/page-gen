import { create } from "zustand";
import type { Chat, Message } from "../../shared/types.ts";

const ACTIVE_CHAT_KEY = "pagegen:activeChatId";

interface ChatState {
  chats: Chat[];
  activeChat: Chat | null;
  messages: Message[];
  setChats: (chats: Chat[]) => void;
  setActiveChat: (chat: Chat | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  renameChat: (id: string, title: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  activeChat: null,
  messages: [],
  setChats: (chats) => set({ chats }),
  setActiveChat: (chat) => {
    if (chat) {
      localStorage.setItem(ACTIVE_CHAT_KEY, chat.id);
    } else {
      localStorage.removeItem(ACTIVE_CHAT_KEY);
    }
    set({ activeChat: chat });
  },
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  renameChat: (id, title) =>
    set((state) => ({
      chats: state.chats.map((c) => (c.id === id ? { ...c, title } : c)),
      activeChat:
        state.activeChat?.id === id
          ? { ...state.activeChat, title }
          : state.activeChat,
    })),
}));
