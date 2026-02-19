const BASE_URL = "/api";

function getApiKeyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const keys = localStorage.getItem("apiKeys");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (parsed.anthropic?.apiKey) headers["X-Api-Key-Anthropic"] = parsed.anthropic.apiKey;
      if (parsed.openai?.apiKey) headers["X-Api-Key-OpenAI"] = parsed.openai.apiKey;
      if (parsed.google?.apiKey) headers["X-Api-Key-Google"] = parsed.google.apiKey;
      if (parsed.anthropic?.proxyUrl) headers["X-Proxy-Url-Anthropic"] = parsed.anthropic.proxyUrl;
      if (parsed.openai?.proxyUrl) headers["X-Proxy-Url-OpenAI"] = parsed.openai.proxyUrl;
      if (parsed.google?.proxyUrl) headers["X-Proxy-Url-Google"] = parsed.google.proxyUrl;
    } catch {
      // ignore invalid JSON
    }
  }
  return headers;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getApiKeyHeaders(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((error as { error: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
