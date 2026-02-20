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
- Sent via `X-Proxy-Url-{Provider}` headers
- Validated as proper URLs on entry

## Generated Code Sandbox

- Each project runs in its own Vite dev server
- Preview is rendered in an `<iframe>` with `sandbox` attribute
- iframe has no access to the parent app's localStorage or cookies
- File operations are scoped to `/projects/{projectId}/` — no parent directory traversal

## Agent Tool Restrictions

- File read/write restricted to project directory
- Shell commands run in sandboxed context
- No access to parent app's database or config

## Docker Isolation

When running via `bun dev:docker`, all generated code executes inside a Docker container:

- Source code is bind-mounted **read-only** — generated code cannot modify the Page Gen backend or source files
- Named volumes (`data/`, `logs/`, `projects/`) are writable but scoped — generated projects can only write within their own project directory
- Preview servers bind to `0.0.0.0` inside the container but are only accessible via mapped ports on localhost
- `node_modules` are built inside the container via anonymous volume, isolated from host
- **Residual risk**: generated code can *read* the Page Gen source code (but not secrets — API keys are in browser localStorage, never on disk)
- See [Docker](Docker) for full details

## Network Access

- Backend listens only on localhost (127.0.0.1)
- No external network exposure
- All communication is local HTTP/WS
