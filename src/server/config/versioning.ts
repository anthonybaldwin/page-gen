// Git versioning settings

// Display limits
export const MAX_AUTO_VERSIONS_DISPLAY = 20;
export const MAX_USER_VERSIONS_DISPLAY = 50;

// Commit prefixes
export const AUTO_COMMIT_PREFIX = "auto:";
export const USER_COMMIT_PREFIX = "user:";

// Per-pipeline caps
export const MAX_AGENT_VERSIONS_PER_RUN = 3;

// Stage hook toggle
export const STAGE_HOOKS_ENABLED = true;

// Git defaults
export const DEFAULT_GIT_NAME = "Page Gen User";
export const DEFAULT_GIT_EMAIL = "user@pagegen.local";

// Gitignore template
export const DEFAULT_GITIGNORE = `node_modules/
.env
.env.*
*.pem
credentials*
`;
