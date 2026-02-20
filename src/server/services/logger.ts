import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LOG_DIR = join(import.meta.dir, "../../../logs");
const LOG_FILE = join(LOG_DIR, "pipeline.log");

let initialized = false;

function ensureDir() {
  if (!initialized) {
    mkdirSync(LOG_DIR, { recursive: true });
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
