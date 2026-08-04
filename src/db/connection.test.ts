import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabaseConnection } from "./connection";

let testDirectory: string;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-db-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("createDatabaseConnection", () => {
  it("opens SQLite with a five-second busy timeout", () => {
    const connection = createDatabaseConnection(join(testDirectory, "timeout.sqlite"));

    try {
      expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(5_000);
    } finally {
      connection.sqlite.close();
    }
  });

  it("requires WAL journal mode", () => {
    const connection = createDatabaseConnection(join(testDirectory, "wal.sqlite"));

    try {
      expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      connection.sqlite.close();
    }
  });

  it("enables and enforces foreign keys", () => {
    const connection = createDatabaseConnection(join(testDirectory, "foreign-keys.sqlite"));

    try {
      expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      connection.sqlite.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (
          id INTEGER PRIMARY KEY,
          parent_id INTEGER NOT NULL REFERENCES parent(id)
        );
      `);

      expect(() => {
        connection.sqlite.prepare("INSERT INTO child (id, parent_id) VALUES (?, ?)").run(1, 999);
      }).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      connection.sqlite.close();
    }
  });

  it("creates isolated handles for separate temporary databases", () => {
    const first = createDatabaseConnection(join(testDirectory, "first.sqlite"));
    const second = createDatabaseConnection(join(testDirectory, "second.sqlite"));

    try {
      first.sqlite.exec("CREATE TABLE marker (value TEXT NOT NULL)");
      first.sqlite.prepare("INSERT INTO marker (value) VALUES (?)").run("first");

      const secondTables = second.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marker'")
        .all();
      expect(secondTables).toEqual([]);
    } finally {
      first.sqlite.close();
      second.sqlite.close();
    }
  });

  it("closes a handle when WAL setup fails", () => {
    const close = vi.spyOn(Database.prototype, "close");

    expect(() => createDatabaseConnection(":memory:")).toThrow(/WAL/);
    expect(close).toHaveBeenCalledOnce();
  });
});
