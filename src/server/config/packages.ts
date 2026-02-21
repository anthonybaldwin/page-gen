// Packages blocked from agent-generated projects.
// These require native compilation (node-gyp) or are unavailable in the Bun sandbox.
// When an agent tries to write a package.json containing these, the tool returns an
// error with the suggested alternative so the agent can self-correct.

export const BLOCKED_PACKAGES: Record<string, string> = {
  "better-sqlite3": "Use bun:sqlite instead (built-in, no native compilation)",
  "sqlite3": "Use bun:sqlite instead (built-in, no native compilation)",
  "bcrypt": "Use Bun.password.hash() / Bun.password.verify() instead",
  "sharp": "Not available — use CSS for image styling or skip image processing",
  "node-gyp": "Native compilation is not supported in this environment",
  "node-pre-gyp": "Native compilation is not supported in this environment",
};
