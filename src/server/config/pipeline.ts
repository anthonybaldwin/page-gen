// Orchestrator & agent execution constants

import { db, schema } from "../db/index.ts";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// PIPELINE_DEFAULTS — the single registry of tunable pipeline constants.
// Every key here is exposed in Settings > Limits > Pipeline Settings.
// ---------------------------------------------------------------------------

export const PIPELINE_DEFAULTS: Record<string, number> = {
  maxBuildFixAttempts: 3,
  maxRemediationCycles: 2,
  buildFixMaxOutputTokens: 16_000,
  buildFixMaxToolSteps: 10,
  defaultMaxOutputTokens: 8192,
  defaultMaxToolSteps: 10,
  buildTimeoutMs: 30_000,
  testTimeoutMs: 60_000,
  maxTestFailures: 5,
  maxUniqueErrors: 10,
  warningThreshold: 80, // stored as integer percentage (80 = 0.80)
  maxVersionsRetained: 50,
  maxAgentVersionsPerRun: 3,
  reasoningMinOutputTokens: 16_000,
  allowShellTools: 0, // 0 = disabled, 1 = enabled — gates shell-based custom tools
  checkpointTimeoutMs: 600_000, // 10 minutes default timeout for checkpoint pauses

  // Shell action defaults
  shellCommandTimeoutMs: 60_000,
  shellMaxOutputLength: 50_000,

  // Intent classification
  classifyMaxOutputTokens: 100,
  classifyMaxHistoryMessages: 3,
  classifyMaxHistoryChars: 500,

  // Summary / digest
  summaryMaxOutputTokens: 1024,
  summaryDigestTruncateChars: 500,

  // Question answering
  questionMaxOutputTokens: 2048,

  // LLM-call action
  llmCallMaxOutputTokens: 4096,

  // Mood analysis
  moodAnalysisMaxImages: 5,
  moodAnalysisMaxOutputTokens: 1000,

  // Test-run action
  testRunMaxAttempts: 2,

  // Chat title generation
  titleMaxChars: 60,

  // Stream throttle (ms between SSE broadcasts)
  streamThrottleMs: 150,
};

/**
 * Read a pipeline setting from app_settings (key prefix `pipeline.`),
 * falling back to PIPELINE_DEFAULTS.
 */
export function getPipelineSetting(key: string): number {
  const dbKey = `pipeline.${key}`;
  const row = db.select().from(schema.appSettings).where(eq(schema.appSettings.key, dbKey)).get();
  if (row) return Number(row.value);
  const def = PIPELINE_DEFAULTS[key];
  return def ?? 0;
}

// ---------------------------------------------------------------------------
// Named exports — kept for backwards compatibility.
// Values that are tunable read from the DB-backed getter at import time
// where possible, but most consumers should call getPipelineSetting() at
// call-site for runtime configurability.
// ---------------------------------------------------------------------------

// Retries
export const MAX_RETRIES = 3;
export const MAX_BUILD_FIX_ATTEMPTS = 3;
export const MAX_REMEDIATION_CYCLES = 2;

// Output caps
export const MAX_OUTPUT_CHARS = 15_000;
export const MAX_PROJECT_SOURCE_CHARS = 40_000;
export const MAX_SOURCE_SIZE = 100_000;

// Agent token limits
export const AGENT_MAX_OUTPUT_TOKENS: Record<string, number> = {
  research: 3000,
  architect: 12000,
  "frontend-dev": 64000,
  "backend-dev": 32000,
  styling: 32000,
  "code-review": 2048,
  security: 2048,
  qa: 2048,
};
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Agent tool step limits
export const AGENT_MAX_TOOL_STEPS: Record<string, number> = {
  "frontend-dev": 16,
  "backend-dev": 12,
  styling: 10,
};
export const DEFAULT_MAX_TOOL_STEPS = 10;

// Build-fix caps
export const BUILD_FIX_MAX_OUTPUT_TOKENS = 16_000;
export const BUILD_FIX_MAX_TOOL_STEPS = 10;

// Timeouts
export const BUILD_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 60_000;
export const STAGGER_MS = 1000;

// LLM caps
export const ORCHESTRATOR_CLASSIFY_MAX_TOKENS = 20;
export const SUMMARY_MAX_OUTPUT_TOKENS = 1024;
export const QUESTION_MAX_OUTPUT_TOKENS = 2048;

// Data detection thresholds (for readProjectSource)
export const DATA_DIR_PATTERNS = /(?:^|\/)(?:src\/)?data\//;

// Shell
export const SHELL_TIMEOUT_MS = 30_000;
export const SHELL_MAX_OUTPUT_LENGTH = 10_000;

// Review
export const REVIEWER_SOURCE_CAP = 30_000;
export const MAX_UNIQUE_ERRORS = 10;
export const MAX_TEST_FAILURES = 5;
