import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { prepareProjectForPreview } from "../../src/server/preview/vite-server.ts";

const TEST_PROJECT_PATH = join(process.cwd(), "test-project-preview");

beforeEach(() => {
  rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
  mkdirSync(TEST_PROJECT_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_PROJECT_PATH, { recursive: true, force: true });
});

describe("prepareProjectForPreview", () => {
  test("creates vitest.config.ts during scaffolding", async () => {
    await prepareProjectForPreview(TEST_PROJECT_PATH);
    const configPath = join(TEST_PROJECT_PATH, "vitest.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("vitest/config");
    expect(content).toContain("happy-dom");
    expect(content).toContain("react");
  }, 30000);

  test("does NOT overwrite existing vitest.config.ts", async () => {
    const configPath = join(TEST_PROJECT_PATH, "vitest.config.ts");
    const customConfig = "// custom config\nexport default {};";
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
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies["happy-dom"]).toBeDefined();
    expect(pkg.devDependencies["@testing-library/react"]).toBeDefined();
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
