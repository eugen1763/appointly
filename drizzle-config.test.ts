import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUNTIME_ONLY_ENVIRONMENT_NAMES = [
  "APP_URL",
  "BETTER_AUTH_SECRET",
  "GUEST_TOKEN_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_AUTH_ENABLED",
  "TRUST_PROXY",
] as const;

let testDirectory: string;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-drizzle-config-"));
  for (const name of RUNTIME_ONLY_ENVIRONMENT_NAMES) vi.stubEnv(name, undefined);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("drizzle.config", () => {
  it("loads with only DATABASE_PATH and targets both future schema files", async () => {
    const databasePath = join(testDirectory, "config.sqlite");
    vi.stubEnv("DATABASE_PATH", databasePath);

    // The dynamic import is the behavior under test: config evaluation must use this clean environment.
    const { default: config } = await import("./drizzle.config");

    expect(config).toMatchObject({
      dialect: "sqlite",
      schema: ["./src/db/auth-schema.ts", "./src/db/schema.ts"],
      out: "./drizzle",
      dbCredentials: { url: databasePath },
    });
  });

  it("rejects an absent database path", async () => {
    vi.stubEnv("DATABASE_PATH", undefined);

    await expect(import("./drizzle.config")).rejects.toThrow(/DATABASE_PATH/);
  });
});
