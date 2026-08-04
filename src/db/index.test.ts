import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getDatabaseConnection } from "./index";

let testDirectory: string;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-production-db-"));
  vi.stubEnv("DATABASE_PATH", join(testDirectory, "production.sqlite"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(testDirectory, { force: true, recursive: true });
});

it("reuses one process-wide SQLite handle and Drizzle database", () => {
  const first = getDatabaseConnection();
  const second = getDatabaseConnection();

  expect(second.sqlite).toBe(first.sqlite);
  expect(second.db).toBe(first.db);

  first.sqlite.close();
});
