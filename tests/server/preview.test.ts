import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { prepareProjectForPreview } from "../../src/server/preview/preview-server.ts";

const TEST_PROJECT_PATH = join(process.cwd(), "test-project-preview");

beforeEach(() => {
  rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
});

describe("prepareProjectForPreview", () => {
  test("creates bunfig.toml during scaffolding", async () => {
    await prepareProjectForPreview(TEST_PROJECT_PATH);
    const configPath = join(TEST_PROJECT_PATH, "bunfig.toml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("bun-plugin-tailwind");
    expect(content).toContain("[test]");
    expect(content).toContain("test-setup.ts");
  }, 30000);

  test("does NOT overwrite existing bunfig.toml", async () => {
    const configPath = join(TEST_PROJECT_PATH, "bunfig.toml");
    const customConfig = "# custom config\n";
    writeFileSync(configPath, customConfig, "utf-8");

    await prepareProjectForPreview(TEST_PROJECT_PATH);

    const content = readFileSync(configPath, "utf-8");
    expect(content).toBe(customConfig);
  }, 30000);

  test("creates package.json with testing deps", async () => {
    await prepareProjectForPreview(TEST_PROJECT_PATH);
    const pkgPath = join(TEST_PROJECT_PATH, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.devDependencies["bun-plugin-tailwind"]).toBeDefined();
    expect(pkg.devDependencies["happy-dom"]).toBeDefined();
    expect(pkg.devDependencies["@testing-library/react"]).toBeDefined();
    // Stale Vite-era deps should not be present
    expect(pkg.devDependencies.vite).toBeUndefined();
    expect(pkg.devDependencies["@vitejs/plugin-react"]).toBeUndefined();
    expect(pkg.devDependencies.vitest).toBeUndefined();
  }, 30000);

  test("removes stale vite.config.ts and vitest.config.ts", async () => {
    writeFileSync(join(TEST_PROJECT_PATH, "vite.config.ts"), "// old", "utf-8");
    writeFileSync(join(TEST_PROJECT_PATH, "vitest.config.ts"), "// old", "utf-8");

    await prepareProjectForPreview(TEST_PROJECT_PATH);

    expect(existsSync(join(TEST_PROJECT_PATH, "vite.config.ts"))).toBe(false);
    expect(existsSync(join(TEST_PROJECT_PATH, "vitest.config.ts"))).toBe(false);
  }, 30000);

  test("uses project name as package name when provided", async () => {
    await prepareProjectForPreview(TEST_PROJECT_PATH, undefined, "My Cool App!");
    const pkgPath = join(TEST_PROJECT_PATH, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("my-cool-app");
  }, 30000);

  test("does not overwrite existing package name", async () => {
    const pkgPath = join(TEST_PROJECT_PATH, "package.json");
    writeFileSync(pkgPath, JSON.stringify({ name: "custom-name" }), "utf-8");
    await prepareProjectForPreview(TEST_PROJECT_PATH, undefined, "Different Name");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("custom-name");
  }, 30000);

  test("falls back to preview-project when no name provided", async () => {
    await prepareProjectForPreview(TEST_PROJECT_PATH);
    const pkgPath = join(TEST_PROJECT_PATH, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("preview-project");
  }, 30000);
});
