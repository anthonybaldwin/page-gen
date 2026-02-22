import React, { Suspense } from "react";
import type { Message } from "../../../shared/types.ts";
const MarkdownContent = React.lazy(() => import("./MarkdownContent.tsx").then(m => ({ default: m.MarkdownContent })));
import { Badge } from "../ui/badge.tsx";

function isAgentOutput(msg: Message): boolean {
  if (!msg.metadata) return false;
  try {
    const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
    return meta?.type === "agent_output";
  } catch {
    return false;
  }
}

export function isVisibleChatMessage(msg: Message): boolean {
  return !isAgentOutput(msg);
}

export function ChatMessageItem({ msg }: { msg: Message }) {
  return (
    <div className={`flex px-4 py-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm overflow-hidden ${
          msg.role === "user"
            ? "bg-[#57BE55] text-white"
            : msg.role === "system"
              ? "bg-muted text-muted-foreground italic"
              : "bg-card border border-border text-card-foreground"
        }`}
      >
        {msg.agentName && (
          <div className="mb-1">
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
              {msg.agentName}
            </Badge>
          </div>
        )}
        {msg.role === "user" ? (
          <div className="whitespace-pre-wrap">{msg.content}</div>
        ) : (
          <Suspense fallback={<div className="whitespace-pre-wrap">{msg.content}</div>}>
            <MarkdownContent content={msg.content} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export function MessageList({ messages }: { messages: Message[] }) {
  // Filter out raw agent output messages — these are shown as thinking blocks instead
  const visibleMessages = messages.filter(isVisibleChatMessage);

  if (visibleMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">
          Start by describing what you want to build.
        </p>
      </div>
    );
  }

  return <div className="py-2">{visibleMessages.map((msg) => <ChatMessageItem key={msg.id} msg={msg} />)}</div>;
}
