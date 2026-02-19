import { describe, it, expect } from "bun:test";
import { isPlaintextJson } from "../../src/client/lib/crypto.ts";

describe("isPlaintextJson", () => {
  it("returns true for a plain API key object", () => {
    const raw = JSON.stringify({ anthropic: { apiKey: "sk-ant-123" } });
    expect(isPlaintextJson(raw)).toBe(true);
  });

  it("returns true for an empty object", () => {
    expect(isPlaintextJson("{}")).toBe(true);
  });

  it("returns false for encrypted format with v field", () => {
    const raw = JSON.stringify({ iv: "abc", data: "def", v: 1 });
    expect(isPlaintextJson(raw)).toBe(false);
  });

  it("returns false for invalid JSON", () => {
    expect(isPlaintextJson("not json")).toBe(false);
  });

  it("returns false for a JSON array", () => {
    expect(isPlaintextJson("[]")).toBe(false);
  });

  it("returns false for null JSON", () => {
    expect(isPlaintextJson("null")).toBe(false);
  });

  it("returns false for a string JSON", () => {
    expect(isPlaintextJson('"hello"')).toBe(false);
  });

  it("returns true for nested objects without v field", () => {
    const raw = JSON.stringify({
      anthropic: { apiKey: "sk-ant-123", proxyUrl: "https://proxy.example.com" },
      openai: { apiKey: "sk-456" },
    });
    expect(isPlaintextJson(raw)).toBe(true);
  });
});
