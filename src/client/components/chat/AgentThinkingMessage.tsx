import React, { Suspense, useRef, useEffect, useMemo, useState } from "react";
const MarkdownContent = React.lazy(() => import("./MarkdownContent.tsx").then(m => ({ default: m.MarkdownContent })));
import { TestResultsBanner } from "./TestResultsBanner.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Loader2, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import type { ThinkingBlock, ToolCallEntry } from "../../stores/agentThinkingStore.ts";

interface Props {
  block: ThinkingBlock;
  onToggle: () => void;
}

function summarizeStructuredOutput(raw: string): string {
  const lines: string[] = [];

  const jsonBlocks = raw.match(/```json\n([\s\S]*?)```/g) || [];
  const inlineJson = raw.match(/^\s*\{[\s\S]*\}\s*$/m);
  const sources = [...jsonBlocks.map((b) => b.replace(/```json\n?/, "").replace(/\n?```$/, "")), ...(inlineJson ? [inlineJson[0]] : [])];

  for (const src of sources) {
    try {
      const obj = JSON.parse(src.trim());
      extractReadableFields(obj, lines, 0);
    } catch {
      // Not valid JSON — try partial extraction below
    }
  }

  if (lines.length > 0) return lines.join("\n");

  // Regex extraction for streaming/partial JSON — pair names with nearest descriptions
  const nameMatches = [...raw.matchAll(/"(?:name|title)":\s*"([^"]{2,})"/gi)].map(m => ({ value: m[1]!, pos: m.index! }));
  const descMatches = [...raw.matchAll(/"(?:description|summary|purpose|reason)":\s*"([^"]{10,})"/gi)].map(m => ({ value: m[1]!, pos: m.index! }));

  const seen = new Set<string>();

  if (nameMatches.length > 0) {
    for (let i = 0; i < nameMatches.length; i++) {
      const name = nameMatches[i]!;
      const nextNamePos = i + 1 < nameMatches.length ? nameMatches[i + 1]!.pos : Infinity;
      // Find nearest description after this name but before the next name
      const pairedDesc = descMatches.find(d => d.pos > name.pos && d.pos < nextNamePos);
      const key = `name:${name.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (pairedDesc) {
        lines.push(`- **${name.value}** — ${pairedDesc.value}`);
        seen.add(`desc:${pairedDesc.value}`);
      } else {
        lines.push(`- **${name.value}**`);
      }
    }
    // Add any unpaired descriptions
    for (const desc of descMatches) {
      if (!seen.has(`desc:${desc.value}`)) {
        lines.push(`- ${desc.value}`);
        seen.add(`desc:${desc.value}`);
      }
    }
  } else {
    // No names found — show descriptions as plain bullets
    for (const desc of descMatches) {
      const key = `desc:${desc.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`- ${desc.value}`);
      }
    }
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

  const nameField = record.name || record.title || record.label;
  const descField = record.description || record.summary || record.purpose || record.reason;

  if (nameField && descField) {
    lines.push(`- **${nameField}** — ${descField}`);
  } else if (descField) {
    lines.push(`- ${descField}`);
  } else if (nameField && typeof nameField === "string") {
    const children = record.children || record.items || record.steps || record.components;
    if (Array.isArray(children) && children.length > 0) {
      lines.push(`**${nameField}:**`);
      extractReadableFields(children, lines, depth + 1);
    } else {
      lines.push(`- ${nameField}`);
    }
  }

  for (const key of ["features", "components", "file_plan", "dependencies", "shared_utilities", "steps", "sections", "requirements"]) {
    if (Array.isArray(record[key])) {
      lines.push(`\n**${key.replace(/_/g, " ")}:**`);
      extractReadableFields(record[key], lines, depth + 1);
    }
  }
}

function humanizeToolCall(raw: string): string {
  try {
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
    const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
    const pathMatch = raw.match(/"path"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      const verb = nameMatch[1] === "write_file" ? "Writing" : nameMatch[1] === "read_file" ? "Reading" : nameMatch[1];
      return `\n> ${verb}${pathMatch ? ` \`${pathMatch[1]}\`` : ""}\n`;
    }
    return "";
  }
}

function sanitizeThinking(raw: string): string {
  // Early JSON routing: if content looks like structured JSON, summarize it directly
  // instead of running destructive stripping that produces garbage
  const jsonKeyCount = (raw.match(/"[\w_-]+"\s*:/g) || []).length;
  if (jsonKeyCount >= 3) {
    const structuredSummary = summarizeStructuredOutput(raw);
    if (structuredSummary) return structuredSummary;
  }

  let cleaned = raw;

  cleaned = cleaned.replace(/<tool_call[\s\S]*?(<\/tool_call>|$)/gi, (match) => {
    return humanizeToolCall(match);
  });

  cleaned = cleaned.replace(/<tool_response[\s\S]*?(<\/tool_response>|$)/gi, "");
  cleaned = cleaned.replace(/<tool[\s>][\s\S]*?(<\/tool>|$)/gi, "");
  cleaned = cleaned.replace(/<invoke[\s\S]*?(<\/invoke>|$)/gi, "");
  cleaned = cleaned.replace(/<result[\s\S]*?(<\/result>|$)/gi, "");

  cleaned = cleaned.replace(/<\/?[\w_-]+(?:\s+[\w_-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]*))?)*\s*\/?>/g, "");

  cleaned = cleaned.replace(/```(?:json|xml|typescript|tsx|ts|jsx|javascript|js|css|html)?\n[\s\S]*?```/g, (match) => {
    const inner = match.replace(/```\w*\n?/, "").replace(/\n?```$/, "").trim();
    if (inner.startsWith("{") || inner.startsWith("[") || inner.startsWith("<")) return "\n\n";
    if (inner.split("\n").length > 10) return "\n\n";
    return match;
  });

  cleaned = cleaned.replace(/^\s*\{[\s\S]*?\}\s*$/gm, (match) => {
    if (match.includes('"') && (match.includes(":") || match.includes(","))) return "";
    return match;
  });

  cleaned = cleaned.replace(/^\s*[{["][\s\S]{20,}$/gm, (match) => {
    if (match.includes('"') && match.includes(":")) return "";
    return match;
  });

  cleaned = cleaned.replace(/^\s*[}\]],?\s*$/gm, "");
  cleaned = cleaned.replace(/^\s*"[\w_-]+"\s*:\s*(?:"[^"]*"|[\d.]+|true|false|null|\[.*?\]|\{.*?\}),?\s*$/gm, "");
  // Remove orphan list markers that render as empty bullet/dot artifacts
  cleaned = cleaned.replace(/^\s*[-*]\s*$/gm, "");
  cleaned = cleaned.replace(/^\s*\d+\.\s*$/gm, "");

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/  +/g, " ");
  cleaned = cleaned.trim();

  // Detect if cleaned output is likely garbage from partial JSON stripping
  const looksLikeGarbage =
    cleaned.length < 30 ||
    (raw.length > 100 && (
      // Heavy stripping happened — most content was JSON
      cleaned.length < raw.length * 0.3 ||
      // Cleaned content still has JSON artifacts (3+ punctuation chars in a row)
      /["{}[\]:,]{3,}/.test(cleaned) ||
      // Multiple structured field fragments visible (stripped keys left behind)
      (cleaned.match(/\b(name|description|summary|purpose)\s*:/gi) || []).length >= 2
    ));

  if (looksLikeGarbage) {
    const structuredSummary = summarizeStructuredOutput(raw);
    if (structuredSummary) return structuredSummary;
  }

  return cleaned;
}

function formatToolCall(tc: ToolCallEntry): string {
  const input = tc.input as Record<string, string>;
  switch (tc.toolName) {
    case "write_file": return `Writing ${input.path || "file"}`;
    case "read_file": return `Reading ${input.path || "file"}`;
    case "list_files": return `Listing ${input.directory || "."}`;
    default: return `${tc.toolName}(${input.path || ""})`;
  }
}

export function AgentThinkingMessage({ block, onToggle }: Props) {
  if (block.blockType === "test-results" && block.testResults) {
    return (
      <div className="flex justify-start px-4 py-1.5">
        <div className="w-full max-w-[85%]">
          <TestResultsBanner results={block.testResults} />
        </div>
      </div>
    );
  }

  const { displayName, status, content, summary, error, expanded, toolCalls } = block;
  const isActive = status === "started" || status === "streaming";
  const lastToolCall = toolCalls?.length ? toolCalls[toolCalls.length - 1] : undefined;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  const cleanContent = useMemo(() => sanitizeThinking(content), [content]);
  const hasRawContent = content.length > 0 && content !== cleanContent;

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
            ? "bg-card border-border"
            : status === "completed"
              ? "bg-card/50 border-border/60"
              : "bg-destructive/5 border-destructive/20"
        }`}
      >
        {/* Header */}
        <Button
          variant="ghost"
          onClick={onToggle}
          className="w-full flex items-center gap-2.5 px-3 py-2 h-auto justify-start rounded-none hover:bg-accent/50 group"
        >
          <ThinkingStatusIcon status={status} />
          <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
            {displayName}
          </span>

          {isActive && (
            <span className="text-xs text-muted-foreground italic truncate">
              {lastToolCall ? formatToolCall(lastToolCall) : "thinking..."}
            </span>
          )}

          {status === "completed" && summary && (
            <span className="text-xs text-muted-foreground flex-1 truncate">{summary}</span>
          )}

          {status === "failed" && (
            <span className="text-xs text-destructive truncate flex-1">{error || summary || "failed"}</span>
          )}

          <ChevronDown
            className={`h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-all shrink-0 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </Button>

        {/* Expandable thinking body */}
        {expanded && (
          <div
            ref={scrollRef}
            className="border-t border-border/60 max-h-60 overflow-y-auto"
          >
            {status === "failed" && error && (
              <div className="mx-3 mt-3 mb-1 px-3 py-2 text-xs text-destructive bg-destructive/10 rounded-md border border-destructive/20">
                {error}
              </div>
            )}
            {(cleanContent || showRaw || summary) && (
            <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {showRaw ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-muted-foreground/60">{content}</pre>
              ) : cleanContent ? (
                <Suspense fallback={<div className="whitespace-pre-wrap">{cleanContent}</div>}>
                  <MarkdownContent content={cleanContent} />
                </Suspense>
              ) : summary ? (
                <span className="italic">{summary}</span>
              ) : null}
              {isActive && (
                <span className="inline-block w-1.5 h-3 bg-primary animate-pulse rounded-sm align-middle ml-0.5" />
              )}
            </div>
            )}
            {/* Tool call log */}
            {toolCalls && toolCalls.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                {toolCalls.map((tc, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                    <span className="text-muted-foreground/60 font-mono mr-1">
                      {tc.toolName === "write_file" ? "W" : tc.toolName === "read_file" ? "R" : "L"}
                    </span>
                    {(tc.input as Record<string, string>).path || (tc.input as Record<string, string>).directory || tc.toolName}
                  </Badge>
                ))}
              </div>
            )}
            {/* Toggle raw output */}
            {hasRawContent && !isActive && (
              <div className="px-4 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); setShowRaw(!showRaw); }}
                  className="h-5 px-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
                >
                  {showRaw ? "Show clean" : "Show raw output"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingStatusIcon({ status }: { status: ThinkingBlock["status"] }) {
  if (status === "started" || status === "streaming") {
    return <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />;
  }
  return <XCircle className="h-5 w-5 text-destructive shrink-0" />;
}
