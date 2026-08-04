import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const resetScript = path.resolve("scripts/reset-e2e-db.mjs");
let testDirectory: string;

function runReset(): void {
  execFileSync(process.execPath, [resetScript], {
    cwd: testDirectory,
    stdio: "pipe",
  });
}

beforeEach(() => {
  testDirectory = mkdtempSync(path.join(tmpdir(), "appointly-reset-e2e-"));
});

afterEach(() => {
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("reset-e2e-db", () => {
  it("creates the .tmp directory when it does not exist", () => {
    runReset();

    expect(existsSync(path.join(testDirectory, ".tmp"))).toBe(true);
  });

  it("deletes only the SQLite database and its two sidecar files", () => {
    const temporaryDirectory = path.join(testDirectory, ".tmp");
    mkdirSync(temporaryDirectory);
    const deletedNames = ["e2e.sqlite", "e2e.sqlite-wal", "e2e.sqlite-shm"];
    const preservedNames = ["e2e.sqlite-backup", "other.sqlite", "keep.txt"];

    for (const name of [...deletedNames, ...preservedNames]) {
      writeFileSync(path.join(temporaryDirectory, name), name);
    }

    runReset();

    for (const name of deletedNames) {
      expect(existsSync(path.join(temporaryDirectory, name)), name).toBe(false);
    }
    for (const name of preservedNames) {
      expect(existsSync(path.join(temporaryDirectory, name)), name).toBe(true);
    }
  });

  it("clears the build directory so no stale Turbopack lock survives", () => {
    const developmentCache = path.join(testDirectory, ".next", "dev");
    mkdirSync(developmentCache, { recursive: true });
    writeFileSync(path.join(developmentCache, "lock"), "stale");

    runReset();

    expect(existsSync(path.join(testDirectory, ".next"))).toBe(false);
  });
});
