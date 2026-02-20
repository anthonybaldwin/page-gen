import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LOG_DIR = join(import.meta.dir, "../../../logs");
const LOG_FILE = join(LOG_DIR, "pipeline.log");
const LLM_LOG_DIR = join(LOG_DIR, "llm");

let initialized = false;

function ensureDir() {
  if (!initialized) {
    mkdirSync(LOG_DIR, { recursive: true });
    mkdirSync(LLM_LOG_DIR, { recursive: true });
    initialized = true;
  }
}

export function log(tag: string, message: string, data?: Record<string, unknown>) {
  ensureDir();
  const ts = new Date().toISOString();
  let line = `[${ts}] [${tag}] ${message}`;
  if (data) {
    line += "\n  " + JSON.stringify(data);
  }
  line += "\n";
  console.log(`[${tag}] ${message}`);
  appendFileSync(LOG_FILE, line);
}

export function logError(tag: string, message: string, error?: unknown) {
  ensureDir();
  const ts = new Date().toISOString();
  const errStr = error instanceof Error ? error.message : error !== undefined ? String(error) : "";
  let line = `[${ts}] [${tag}] ERROR: ${message}`;
  if (errStr) line += ` — ${errStr}`;
  line += "\n";
  console.error(`[${tag}] ${message}`, error !== undefined ? error : "");
  appendFileSync(LOG_FILE, line);
}

export function logWarn(tag: string, message: string) {
  ensureDir();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] WARN: ${message}\n`;
  console.warn(`[${tag}] ${message}`);
  appendFileSync(LOG_FILE, line);
}

export function logBlock(tag: string, message: string, block: string) {
  ensureDir();
  const ts = new Date().toISOString();
  const truncated = block.length > 2000
    ? block.slice(0, 2000) + `... [truncated, ${block.length} total]`
    : block;
  const line = `[${ts}] [${tag}] ${message}\n${truncated}\n\n`;
  console.log(`[${tag}] ${message} (${block.length.toLocaleString()}chars)`);
  appendFileSync(LOG_FILE, line);
}

/**
 * Log full LLM input (system prompt + user prompt) to a per-agent file.
 * Files go to logs/llm/<timestamp>_<agent>.in.txt
 * This captures the EXACT context sent to the model for debugging.
 */
export function logLLMInput(tag: string, agentName: string, systemPrompt: string, userPrompt: string) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${agentName}.in.txt`;
  const filepath = join(LLM_LOG_DIR, filename);

  const content = [
    `=== SYSTEM PROMPT (${systemPrompt.length.toLocaleString()} chars) ===`,
    systemPrompt,
    "",
    `=== USER PROMPT (${userPrompt.length.toLocaleString()} chars) ===`,
    userPrompt,
  ].join("\n");

  appendFileSync(filepath, content);
  log(tag, `LLM input logged → logs/llm/${filename}`);
}

/**
 * Log full LLM output to a per-agent file.
 * Files go to logs/llm/<timestamp>_<agent>.out.txt
 * No truncation — captures the complete model response.
 */
export function logLLMOutput(tag: string, agentName: string, output: string) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${agentName}.out.txt`;
  const filepath = join(LLM_LOG_DIR, filename);

  appendFileSync(filepath, output);
  log(tag, `LLM output logged → logs/llm/${filename} (${output.length.toLocaleString()} chars)`);
}
