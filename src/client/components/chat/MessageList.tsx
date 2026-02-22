import React, { Suspense } from "react";
import type { Message } from "../../../shared/types.ts";
const MarkdownContent = React.lazy(() => import("./MarkdownContent.tsx").then(m => ({ default: m.MarkdownContent })));
import { Badge } from "../ui/badge.tsx";

function getMetadataType(msg: Message): string | null {
  if (!msg.metadata) return null;
  try {
    const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
    return meta?.type ?? null;
  } catch {
    return null;
  }
}

/** Messages hidden from the plain chat list (rendered as cards or thinking blocks instead). */
const HIDDEN_METADATA_TYPES = new Set(["agent_output", "vibe-brief", "mood-analysis"]);

export function isVisibleChatMessage(msg: Message): boolean {
  const metaType = getMetadataType(msg);
  return !metaType || !HIDDEN_METADATA_TYPES.has(metaType);
}

/** Check if a message should render as a structured vibe/mood card. */
export function getCardMetadataType(msg: Message): "vibe-brief" | "mood-analysis" | null {
  const metaType = getMetadataType(msg);
  if (metaType === "vibe-brief" || metaType === "mood-analysis") return metaType;
  return null;
}

/** Parse metadata from a message, handling both string and object forms. */
export function parseMetadata(msg: Message): Record<string, unknown> | null {
  if (!msg.metadata) return null;
  try {
    return typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
  } catch {
    return null;
  }
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
