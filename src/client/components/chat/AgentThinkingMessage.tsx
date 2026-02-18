import { MarkdownContent } from "./MarkdownContent.tsx";
import type { ThinkingBlock } from "../../stores/agentThinkingStore.ts";

interface Props {
  block: ThinkingBlock;
  onToggle: () => void;
}

export function AgentThinkingMessage({ block, onToggle }: Props) {
  const { displayName, status, content, summary, expanded } = block;

  return (
    <div className="flex justify-start p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg max-w-[85%] w-full overflow-hidden">
        {/* Header — always visible, clickable */}
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
        >
          <StatusIcon status={status} />
          <span className="text-sm font-medium text-zinc-200">{displayName}</span>
          <span className="text-xs text-zinc-500 flex-1 truncate">
            {status === "started" || status === "streaming"
              ? "is thinking..."
              : status === "completed"
                ? summary
                : "failed"}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Expandable body */}
        {expanded && content && (
          <div className="border-t border-zinc-800 px-3 py-2 max-h-64 overflow-y-auto">
            <div className="text-xs">
              <MarkdownContent content={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ThinkingBlock["status"] }) {
  if (status === "started" || status === "streaming") {
    return (
      <span className="w-4 h-4 flex items-center justify-center">
        <span className="w-3 h-3 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
      </span>
    );
  }
  if (status === "completed") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-500">
        <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
      </svg>
    );
  }
  // failed
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-500">
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}
