# CLAUDE.md

Primary agent instructions are now centralized in `AGENTS.md`.

If you are reading this file as an agent:

1. Load and follow `AGENTS.md` first.
2. Treat `AGENTS.md` as the source of truth for shared workflow, commit, testing, and documentation rules.
3. Only use `CLAUDE.md` for Claude-specific overrides if any are added later.

## Claude-Specific Overrides

### Git Staging

Always stage files explicitly by name. Never use `git commit -am`, `git add -A`, or `git add .`. Only stage the files you actually modified for the current task.
