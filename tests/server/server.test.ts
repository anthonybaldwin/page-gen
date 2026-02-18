import { describe, test, expect, beforeAll, afterAll } from "bun:test";

describe("Server", () => {
  test("health check returns ok", async () => {
    // Import the app directly for testing (avoids port conflicts)
    const { app } = await import("../../src/server/index.ts");
    const res = await app.fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeGreaterThan(0);
  });
});
