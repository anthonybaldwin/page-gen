import { useRef, useEffect, useMemo, useState } from "react";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { TestResultsBanner } from "./TestResultsBanner.tsx";
import type { ThinkingBlock } from "../../stores/agentThinkingStore.ts";

interface Props {
  block: ThinkingBlock;
  onToggle: () => void;
}

/**
 * Try to extract a human-readable summary from structured JSON output.
 * Pulls out string values for common keys like "description", "name", "features", etc.
 */
function summarizeStructuredOutput(raw: string): string {
  const lines: string[] = [];

  // Try to find and parse JSON blocks
  const jsonBlocks = raw.match(/```json\n([\s\S]*?)```/g) || [];
  const inlineJson = raw.match(/^\s*\{[\s\S]*\}\s*$/m);
  const sources = [...jsonBlocks.map((b) => b.replace(/```json\n?/, "").replace(/\n?```$/, "")), ...(inlineJson ? [inlineJson[0]] : [])];

  for (const src of sources) {
    try {
      const obj = JSON.parse(src.trim());
      extractReadableFields(obj, lines, 0);
    } catch {
      // Not valid JSON — skip
    }
  }

  if (lines.length > 0) return lines.join("\n");

  // Fallback: extract quoted string values from JSON-like content
  const stringValues = [...raw.matchAll(/"(description|summary|purpose|name|title|reason)":\s*"([^"]{10,})"/gi)];
  for (const m of stringValues) {
    lines.push(`**${m[1]}:** ${m[2]}`);
  }

  return lines.join("\n");
}

function extractReadableFields(obj: unknown, lines: string[], depth: number) {
  if (depth > 3 || lines.length > 20) return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "string" && item.length > 5) {
        lines.push(`- ${item}`);
      } else if (typeof item === "object" && item !== null) {
        extractReadableFields(item, lines, depth + 1);
      }
    }
    return;
  }

  if (typeof obj !== "object" || obj === null) return;
  const record = obj as Record<string, unknown>;

  // Extract human-readable fields
  const nameField = record.name || record.title || record.label;
  const descField = record.description || record.summary || record.purpose || record.reason;

  if (nameField && descField) {
    lines.push(`- **${nameField}** — ${descField}`);
  } else if (descField) {
    lines.push(`- ${descField}`);
  } else if (nameField && typeof nameField === "string") {
    // Check for nested children
    const children = record.children || record.items || record.steps || record.components;
    if (Array.isArray(children) && children.length > 0) {
      lines.push(`**${nameField}:**`);
      extractReadableFields(children, lines, depth + 1);
    } else {
      lines.push(`- ${nameField}`);
    }
  }

  // Recurse into known collection keys
  for (const key of ["features", "components", "file_plan", "dependencies", "shared_utilities", "steps", "sections", "requirements"]) {
    if (Array.isArray(record[key])) {
      lines.push(`\n**${key.replace(/_/g, " ")}:**`);
      extractReadableFields(record[key], lines, depth + 1);
    }
  }
}

/**
 * Convert a raw <tool_call> XML block into a human-readable one-liner.
 */
function humanizeToolCall(raw: string): string {
  try {
    // Extract the JSON body from the tool_call
    const jsonMatch = raw.match(/<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/i);
    if (!jsonMatch) return "";

    const json = JSON.parse(jsonMatch[1]!.trim());
    const name = json.name || "";
    const params = json.parameters || {};

    switch (name) {
      case "write_file":
        return `\n> Writing \`${params.path}\`\n`;
      case "read_file":
        return `\n> Reading \`${params.path}\`\n`;
      case "search_files":
        return `\n> Searching for \`${params.pattern || params.query || ""}\`\n`;
      case "list_files":
        return `\n> Listing \`${params.path || "."}\`\n`;
      case "shell":
        return `\n> Running \`${(params.command || "").slice(0, 80)}\`\n`;
      default:
        return name ? `\n> ${name}(${params.path || ""})\n` : "";
    }
  } catch {
    // If JSON parse fails, try to extract the tool name and path manually
    const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
    const pathMatch = raw.match(/"path"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      const verb = nameMatch[1] === "write_file" ? "Writing" : nameMatch[1] === "read_file" ? "Reading" : nameMatch[1];
      return `\n> ${verb}${pathMatch ? ` \`${pathMatch[1]}\`` : ""}\n`;
    }
    return "";
  }
}

/**
 * Strip internal agent plumbing from streamed content.
 * Returns clean natural-language text. If the output is mostly structured
 * data (JSON/XML), extracts a human-readable summary from it.
 */
function sanitizeThinking(raw: string): string {
  let cleaned = raw;

  // Replace tool_call blocks with human-readable summaries
  cleaned = cleaned.replace(/<tool_call[\s\S]*?(<\/tool_call>|$)/gi, (match) => {
    return humanizeToolCall(match);
  });

  // Replace tool_response blocks with a brief note
  cleaned = cleaned.replace(/<tool_response[\s\S]*?(<\/tool_response>|$)/gi, "");
  cleaned = cleaned.replace(/<tool[\s>][\s\S]*?(<\/tool>|$)/gi, "");
  cleaned = cleaned.replace(/<invoke[\s\S]*?(<\/invoke>|$)/gi, "");
  cleaned = cleaned.replace(/<result[\s\S]*?(<\/result>|$)/gi, "");

  // Remove any remaining XML-like tags
  cleaned = cleaned.replace(/<\/?[\w_-]+(?:\s+[\w_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*\s*\/?>/g, "");

  // Remove markdown code blocks that contain JSON or structured data
  cleaned = cleaned.replace(/```(?:json|xml|typescript|tsx|ts|jsx|javascript|js|css|html)?\n[\s\S]*?```/g, (match) => {
    const inner = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "").trim();
    if (inner.startsWith("{") || inner.startsWith("[") || inner.startsWith("<")) return "";
    if (inner.split("\n").length > 10) return "";
    return match;
  });

  // Remove multi-line JSON objects/arrays
  cleaned = cleaned.replace(/^\s*\{[\s\S]*?\}\s*$/gm, (match) => {
    if (match.includes('"') && (match.includes(":") || match.includes(","))) return "";
    return match;
  });

  // Remove single-line JSON-like patterns
  cleaned = cleaned.replace(/^\s*[{["][\s\S]{20,}$/gm, (match) => {
    if (match.includes('"') && match.includes(":")) return "";
    return match;
  });

  // Remove leftover JSON fragments
  cleaned = cleaned.replace(/^\s*[}\]],?\s*$/gm, "");
  cleaned = cleaned.replace(/^\s*"[\w_-]+"\s*:\s*(?:"[^"]*"|[\d.]+|true|false|null|\[.*?\]|\{.*?\}),?\s*$/gm, "");

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();

  // If sanitization left very little, try to extract a structured summary from the raw output
  if (cleaned.length < 30 && raw.length > 100) {
    const structuredSummary = summarizeStructuredOutput(raw);
    if (structuredSummary) return structuredSummary;
  }

  return cleaned;
}

export function AgentThinkingMessage({ block, onToggle }: Props) {
  // Render test results blocks inline using TestResultsBanner
  if (block.blockType === "test-results" && block.testResults) {
    return (
      <div className="flex justify-start px-4 py-1.5">
        <div className="w-full max-w-[85%]">
          <TestResultsBanner results={block.testResults} />
        </div>
      </div>
    );
  }

  const { displayName, status, content, summary, expanded } = block;
  const isActive = status === "started" || status === "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  const cleanContent = useMemo(() => sanitizeThinking(content), [content]);
  const hasRawContent = content.length > 0 && content !== cleanContent;

  // Auto-scroll the thinking body to bottom while streaming
  useEffect(() => {
    if (expanded && isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [cleanContent, expanded, isActive]);

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
        {expanded && (cleanContent || showRaw) && (
          <div
            ref={scrollRef}
            className="border-t border-zinc-800/60 max-h-60 overflow-y-auto"
          >
            <div className="px-4 py-3 text-xs leading-relaxed text-zinc-500">
              {showRaw ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-zinc-600">{content}</pre>
              ) : (
                <MarkdownContent content={cleanContent} />
              )}
              {isActive && (
                <span className="inline-block w-1.5 h-3 bg-zinc-500 animate-pulse rounded-sm align-middle ml-0.5" />
              )}
            </div>
            {/* Toggle raw output */}
            {hasRawContent && !isActive && (
              <div className="px-4 pb-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw); }}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {showRaw ? "Show clean" : "Show raw output"}
                </button>
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
