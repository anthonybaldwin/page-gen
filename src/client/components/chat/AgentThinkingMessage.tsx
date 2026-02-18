import { useRef, useEffect } from "react";
import { MarkdownContent } from "./MarkdownContent.tsx";
import type { ThinkingBlock } from "../../stores/agentThinkingStore.ts";

interface Props {
  block: ThinkingBlock;
  onToggle: () => void;
}

export function AgentThinkingMessage({ block, onToggle }: Props) {
  const { displayName, status, content, summary, expanded } = block;
  const isActive = status === "started" || status === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the thinking body to bottom while streaming
  useEffect(() => {
    if (expanded && isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, expanded, isActive]);

  return (
    <div className="flex justify-start px-4 py-1.5">
      <div
        className={`w-full max-w-[85%] rounded-lg overflow-hidden border transition-colors ${
          isActive
            ? "bg-zinc-900/80 border-zinc-700/60"
            : status === "completed"
              ? "bg-zinc-900/50 border-zinc-800/60"
              : "bg-red-950/20 border-red-900/30"
        }`}
      >
        {/* Header — always visible, clickable */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-800/30 transition-colors group"
        >
          <StatusIcon status={status} />
          <span className={`text-sm font-medium ${isActive ? "text-zinc-100" : "text-zinc-400"}`}>
            {displayName}
          </span>

          {isActive && (
            <span className="text-xs text-zinc-500 italic">thinking...</span>
          )}

          {status === "completed" && summary && (
            <span className="text-xs text-zinc-500 flex-1 truncate">{summary}</span>
          )}

          {status === "failed" && (
            <span className="text-xs text-red-400">{summary || "failed"}</span>
          )}

          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-all shrink-0 ${
              expanded ? "rotate-180" : ""
            }`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Expandable thinking body */}
        {expanded && content && (
          <div
            ref={scrollRef}
            className="border-t border-zinc-800/60 max-h-72 overflow-y-auto scrollbar-thin"
          >
            <div className="px-4 py-3 text-sm leading-relaxed text-zinc-400">
              <MarkdownContent content={content} />
            </div>

            {/* Streaming cursor */}
            {isActive && (
              <div className="px-4 pb-3">
                <span className="inline-block w-2 h-4 bg-zinc-500 animate-pulse rounded-sm" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ThinkingBlock["status"] }) {
  if (status === "started" || status === "streaming") {
    return (
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <span className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-emerald-500 shrink-0">
        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
      </svg>
    );
  }
  // failed / stopped
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-red-400 shrink-0">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}
