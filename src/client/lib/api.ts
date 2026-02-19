import { useSettingsStore } from "../stores/settingsStore.ts";

const BASE_URL = "/api";

function getApiKeyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const { anthropic, openai, google } = useSettingsStore.getState();
  if (anthropic?.apiKey) headers["X-Api-Key-Anthropic"] = anthropic.apiKey;
  if (openai?.apiKey) headers["X-Api-Key-OpenAI"] = openai.apiKey;
  if (google?.apiKey) headers["X-Api-Key-Google"] = google.apiKey;
  if (anthropic?.proxyUrl) headers["X-Proxy-Url-Anthropic"] = anthropic.proxyUrl;
  if (openai?.proxyUrl) headers["X-Proxy-Url-OpenAI"] = openai.proxyUrl;
  if (google?.proxyUrl) headers["X-Proxy-Url-Google"] = google.proxyUrl;
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
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
