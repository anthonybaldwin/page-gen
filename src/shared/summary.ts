/**
 * Extract a human-readable summary from agent output text.
 * Handles JSON-outputting agents (research, architect) and
 * code-producing agents that start with fenced blocks.
 */
export function extractSummary(fullText: string, agentName?: string): string {
  if (!fullText || !fullText.trim()) return "Completed";

  // For research/architect — try to parse JSON and extract summary fields
  if (agentName === "research" || agentName === "architect") {
    const jsonSummary = extractJsonSummary(fullText);
    if (jsonSummary) return truncate(jsonSummary, 120);
  }

  // Strip code fence blocks entirely (they contain code, not summaries)
  let text = fullText.trim();
  text = text.replace(/```[\w]*\n[\s\S]*?```/g, "");

  // Split into lines and find first natural-language sentence
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip lines that are code fences, JSON, markdown headers, or structural
    if (
      trimmed.startsWith("`") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("[") ||
      trimmed.startsWith("}") ||
      trimmed.startsWith("]") ||
      /^"[\w_]+":\s/.test(trimmed) ||
      trimmed === "```" ||
      /^```\w*$/.test(trimmed)
    ) {
      continue;
    }

    // Found a natural-language line
    const sentence = trimmed.split(/[.!?\n]/)[0]?.trim();
    if (sentence && sentence.length > 3) {
      return truncate(sentence, 120);
    }
  }

  return "Completed";
}

/**
 * Try to parse JSON from agent output and extract a meaningful summary.
 * Handles both raw JSON and JSON inside code fences.
 */
function extractJsonSummary(text: string): string | null {
  // Try to find JSON — either raw or inside ```json blocks
  let jsonStr = text.trim();

  // Strip code fence wrapper if present
  const fenceMatch = jsonStr.match(/^```(?:json)?\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!.trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Research agent: look for summary or page_type
    if (parsed.summary && typeof parsed.summary === "string") {
      return parsed.summary;
    }
    if (parsed.page_type && typeof parsed.page_type === "string") {
      const componentCount = Array.isArray(parsed.components) ? parsed.components.length : 0;
      const featureCount = Array.isArray(parsed.features) ? parsed.features.length : 0;
      return `${parsed.page_type} page — ${componentCount} components, ${featureCount} features`;
    }

    // Architect agent: look for file_plan
    if (Array.isArray(parsed.file_plan)) {
      return `${parsed.file_plan.length} files planned`;
    }
    if (parsed.component_tree?.name) {
      return `Architecture: ${parsed.component_tree.name} component tree`;
    }

    return null;
  } catch {
    return null;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}
