import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

// --- Configuration ---

const LOG_DIR = process.env.LOG_DIR || join(import.meta.dir, "../../../logs");
const LOG_FILE = join(LOG_DIR, "app.jsonl");
const LLM_LOG_DIR = join(LOG_DIR, "llm");
const LOG_FORMAT = process.env.LOG_FORMAT || "text";

let initialized = false;

function ensureDir() {
  if (!initialized) {
    mkdirSync(LOG_DIR, { recursive: true });
    mkdirSync(LLM_LOG_DIR, { recursive: true });
    initialized = true;
  }
}

// --- Types ---

interface LogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  tag: string;
  msg: string;
  [key: string]: unknown;
}

// --- Core emit ---

function emit(entry: LogEntry) {
  ensureDir();
  const json = JSON.stringify(entry);
  appendFileSync(LOG_FILE, json + "\n");

  if (LOG_FORMAT === "json") {
    (entry.level === "error" ? process.stderr : process.stdout).write(json + "\n");
  } else {
    const prefix = `[${entry.tag}]`;
    if (entry.level === "error") console.error(prefix, entry.msg, entry.error || "");
    else if (entry.level === "warn") console.warn(prefix, entry.msg);
    else console.log(prefix, entry.msg);
  }
}

// --- Public API (same signatures as before) ---

export function log(tag: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { ts: new Date().toISOString(), level: "info", tag, msg: message };
  if (data) entry.data = data;
  emit(entry);
}

export function logError(tag: string, message: string, error?: unknown, data?: Record<string, unknown>) {
  const errStr = error instanceof Error ? error.message : error !== undefined ? String(error) : undefined;
  const entry: LogEntry = { ts: new Date().toISOString(), level: "error", tag, msg: message };
  if (errStr) entry.error = errStr;
  if (data) entry.data = data;
  emit(entry);
}

export function logWarn(tag: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { ts: new Date().toISOString(), level: "warn", tag, msg: message };
  if (data) entry.data = data;
  emit(entry);
}

export function logBlock(tag: string, message: string, block: string) {
  const truncated = block.length > 2000;
  const text = truncated ? block.slice(0, 2000) : block;
  emit({
    ts: new Date().toISOString(),
    level: "info",
    tag,
    msg: message,
    data: { block: text, truncated, totalChars: block.length },
  });
}

/**
 * Log full LLM input (system prompt + user prompt) to a per-agent file.
 * Files go to logs/llm/<timestamp>_<agent>.in.txt
 */
export function logLLMInput(tag: string, agentName: string, systemPrompt: string, userPrompt: string) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${agentName}.in.txt`;
  const filepath = join(LLM_LOG_DIR, filename);
  const totalChars = systemPrompt.length + userPrompt.length;

  const content = [
    `=== SYSTEM PROMPT (${systemPrompt.length.toLocaleString()} chars) ===`,
    systemPrompt,
    "",
    `=== USER PROMPT (${userPrompt.length.toLocaleString()} chars) ===`,
    userPrompt,
  ].join("\n");

  appendFileSync(filepath, content);
  emit({
    ts: new Date().toISOString(),
    level: "info",
    tag,
    msg: "LLM input logged",
    agent: agentName,
    file: `llm/${filename}`,
    chars: totalChars,
  });
}

/**
 * Log full LLM output to a per-agent file.
 * Files go to logs/llm/<timestamp>_<agent>.out.txt
 */
export function logLLMOutput(tag: string, agentName: string, output: string) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${agentName}.out.txt`;
  const filepath = join(LLM_LOG_DIR, filename);

  appendFileSync(filepath, output);
  emit({
    ts: new Date().toISOString(),
    level: "info",
    tag,
    msg: "LLM output logged",
    agent: agentName,
    file: `llm/${filename}`,
    chars: output.length,
  });
}
