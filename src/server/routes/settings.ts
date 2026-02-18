import { Hono } from "hono";

export const settingsRoutes = new Hono();

// Settings are stored client-side in localStorage
// This route is for server-side settings (future use)
settingsRoutes.get("/", (c) => {
  return c.json({
    maxSnapshotsPerProject: 10,
    defaultTokenLimit: 500_000,
    warningThreshold: 0.8,
  });
});
