import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as AuthRoute from "./route";

import { getDatabaseConnection } from "../../../../db";

const originalEnv = { ...process.env };
let testDirectory: string;
let route: typeof AuthRoute;

beforeAll(async () => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-auth-route-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "http://127.0.0.1:3000",
    BETTER_AUTH_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    GUEST_TOKEN_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_AUTH_ENABLED: "true",
    DATABASE_PATH: join(testDirectory, "auth.sqlite"),
    TRUST_PROXY: "false",
  });
  delete process.env.E2E_AUTH;

  const connection = getDatabaseConnection();
  migrate(connection.db, { migrationsFolder: join(process.cwd(), "drizzle") });
  // The route reads and freezes runtime environment values during module loading.
  route = await import("./route");
});

afterAll(() => {
  getDatabaseConnection().sqlite.close();
  process.env = originalEnv;
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("Better Auth catch-all route", () => {
  it("exports only GET and POST handlers", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });

  it("returns Better Auth's raw no-session response without an app error wrapper", async () => {
    const response = await route.GET(
      new Request("http://127.0.0.1:3000/api/auth/get-session"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toBeNull();
  });
});
