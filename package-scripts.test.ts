import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const expectedScripts = {
  typecheck: "tsc --noEmit",
  test: "vitest run",
  "pretest:e2e": "node scripts/reset-e2e-db.mjs",
  "test:e2e": "playwright test",
  "auth:generate": "auth generate --config src/lib/auth.ts --output src/db/auth-schema.ts --yes",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
};

describe("package scripts", () => {
  it("defines every required command exactly", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toMatchObject(expectedScripts);
  });
});
