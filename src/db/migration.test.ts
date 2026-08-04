import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseConnection, type DatabaseConnection } from "./connection";

const expectedTables = [
  "account",
  "appointment_managers",
  "appointment_options",
  "appointments",
  "guest_session_access",
  "guest_sessions",
  "participants",
  "rate_limit_windows",
  "responses",
  "session",
  "user",
  "verification",
];

let testDirectory: string;
let connection: DatabaseConnection | undefined;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-migration-"));
});

afterEach(() => {
  connection?.sqlite.close();
  connection = undefined;
  rmSync(testDirectory, { force: true, recursive: true });
});

describe("checked-in migration", () => {
  it("applies to a fresh WAL database with foreign keys active and only the 12 product tables", () => {
    connection = createDatabaseConnection(join(testDirectory, "fresh.sqlite"));

    migrate(connection.db, { migrationsFolder: join(process.cwd(), "drizzle") });

    const productTables = connection.sqlite
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '__drizzle_%'
        ORDER BY name
      `)
      .pluck()
      .all();

    expect(productTables).toEqual(expectedTables);
    expect(connection.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(connection.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("uses indexes for child foreign-key lookups not covered by parent-key indexes", () => {
    connection = createDatabaseConnection(join(testDirectory, "indexed.sqlite"));
    migrate(connection.db, { migrationsFolder: join(process.cwd(), "drizzle") });

    const expectIndexedLookup = (table: string, sql: string): void => {
      const queryPlan = connection!.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all("lookup-id") as Array<{ detail: string }>;

      expect(queryPlan.some(({ detail }) => (
        detail.includes(`SEARCH ${table} USING INDEX`)
      ))).toBe(true);
    };

    expectIndexedLookup(
      "guest_session_access",
      "SELECT session_token_hash FROM guest_session_access WHERE participant_id = ?",
    );
    expectIndexedLookup(
      "appointments",
      "SELECT id FROM appointments WHERE owner_user_id = ?",
    );
    expectIndexedLookup(
      "appointments",
      "SELECT id FROM appointments WHERE final_option_id = ?",
    );
  });
});
