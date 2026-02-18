import type { Message } from "../../../shared/types.ts";
import { MarkdownContent } from "./MarkdownContent.tsx";

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-zinc-500 text-sm">
          Start by describing what you want to build.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === "user"
                ? "bg-blue-600 text-white"
                : msg.role === "system"
                  ? "bg-zinc-800 text-zinc-400 italic"
                  : "bg-zinc-800 text-zinc-100"
            }`}
          >
            {msg.agentName && (
              <div className="text-xs text-zinc-400 mb-1 font-medium">
                {msg.agentName}
              </div>
            )}
            {msg.role === "user" ? (
              <div className="whitespace-pre-wrap">{msg.content}</div>
            ) : (
              <MarkdownContent content={msg.content} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
