# Security Model

## API Key Storage

API keys are stored **exclusively** in the browser's `localStorage`. They are never persisted server-side.

### Flow
1. User enters API keys in the setup modal (first visit) or settings
2. Keys are saved to `localStorage` under the `apiKeys` key
3. On every API request, keys are sent via custom headers:
   - `X-Api-Key-Anthropic`
   - `X-Api-Key-OpenAI`
   - `X-Api-Key-Google`
4. Backend extracts keys from headers, creates provider instances per-request
5. Keys are hashed (SHA-256) for usage tracking — the hash is stored, never the key

### Encryption at Rest
API keys are encrypted before being stored in localStorage using AES-GCM (256-bit) via the Web Crypto API:

1. A non-extractable AES-GCM 256-bit `CryptoKey` is generated and stored in IndexedDB (`jbi-keystore` database, `keys` store)
2. On save, keys are encrypted with a random 12-byte IV and stored as `{ iv, data, v: 1 }` JSON in the `apiKeys` localStorage key
3. On load, the CryptoKey is retrieved from IndexedDB and used to decrypt the stored ciphertext
4. **Auto-migration:** On first load after the encryption feature was added, plaintext keys are automatically encrypted and re-saved
5. **Fallback:** If Web Crypto or IndexedDB is unavailable (e.g., older browsers), keys are stored as plaintext with a console warning

### Proxy URLs
- Users can optionally set proxy URLs per provider
- Proxy URLs override the default API base URL
- Sent via `X-Proxy-Url-Anthropic`, `X-Proxy-Url-OpenAI`, `X-Proxy-Url-Google` headers

## Generated Code Sandbox

- Each project runs in its own Vite dev server
- Preview is rendered in an `<iframe>` with `sandbox="allow-scripts allow-same-origin allow-forms"`
- Because the preview runs on a different port (3001+), the browser's same-origin policy prevents cross-origin storage access despite `allow-same-origin`
- File operations are scoped to the project directory (e.g., `projects/{projectId}/`) — resolved paths must start with the project root, preventing parent directory traversal

## Agent Tool Restrictions

- Agents have no shell or command execution capabilities — tools are limited to `write_file`, `write_files`, `read_file`, and `list_files`
- File read/write restricted to project directory (enforced by project-scoped path validation)
- No access to parent app's database or config (enforced by path validation in file tools)

## Docker Isolation

When running via `bun dev:docker`, all generated code executes inside a Docker container:

- Source code is bind-mounted **read-only** — generated code cannot modify the Page Gen backend or source files
- Bind mounts (`data/`, `logs/`) are writable but scoped; `projects/` is a bind mount so generated files are visible on the host
- Preview servers bind to `0.0.0.0` inside the container but are only accessible via mapped ports on localhost
- `node_modules` are built inside the container via anonymous volume, isolated from host
- **Residual risk**: generated code can *read* the Page Gen source code (but not secrets — API keys are in browser localStorage, never on disk)
- See [Docker](Docker) for full details

## Network Access

- Backend listens on `0.0.0.0` by default (all interfaces). In Docker mode, the container's port mapping controls external exposure. For local-only use without Docker, consider binding to `127.0.0.1` explicitly.
- All communication is local HTTP/WS
