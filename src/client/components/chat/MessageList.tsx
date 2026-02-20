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

export function MessageList({ messages }: { messages: Message[] }) {
  // Filter out raw agent output messages — these are shown as thinking blocks instead
  const visibleMessages = messages.filter((m) => !isAgentOutput(m));

  if (visibleMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">
          Start by describing what you want to build.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {visibleMessages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
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
      ))}
    </div>
  );
}
