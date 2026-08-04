import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabaseConnection, type DatabaseConnection } from "../../../db/connection";
import {
  createProductionServiceContext,
  type EventPublisher,
  type ServiceContext,
} from "./service-context";
import { runImmediate } from "./transactions";

let testDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  testDirectory = mkdtempSync(join(tmpdir(), "appointly-transactions-"));
  connection = createDatabaseConnection(join(testDirectory, "transactions.sqlite"));
  connection.sqlite.exec("CREATE TABLE transaction_markers (value TEXT NOT NULL)");
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(testDirectory, { force: true, recursive: true });
});

function createTestContext(
  eventPublisher: EventPublisher = { publish: vi.fn() },
): ServiceContext {
  return {
    ...connection,
    clock: { now: () => 1_800_000_000_000 },
    tokenFactory: () => Buffer.alloc(32, 0x5a),
    eventPublisher,
  };
}

function markerValues(): string[] {
  return connection.sqlite
    .prepare("SELECT value FROM transaction_markers ORDER BY rowid")
    .pluck()
    .all() as string[];
}

describe("runImmediate", () => {
  it("commits a synchronous operation and returns its value", () => {
    const result = runImmediate(createTestContext(), ({ sqlite }) => {
      sqlite.prepare("INSERT INTO transaction_markers (value) VALUES (?)").run("committed");
      return 42;
    });

    expect(result).toBe(42);
    expect(markerValues()).toEqual(["committed"]);
  });

  it("rolls back writes when the operation throws", () => {
    expect(() => runImmediate(createTestContext(), ({ sqlite }) => {
      sqlite.prepare("INSERT INTO transaction_markers (value) VALUES (?)").run("rolled-back");
      throw new Error("operation failed");
    })).toThrow("operation failed");

    expect(markerValues()).toEqual([]);
  });

  it("rejects Promise-like output before commit and rolls back its writes", () => {
    let thrown: unknown;
    try {
      runImmediate(createTestContext(), ({ sqlite }) => {
        sqlite.prepare("INSERT INTO transaction_markers (value) VALUES (?)").run("async-write");
        return Promise.resolve("too late");
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);

    expect(markerValues()).toEqual([]);
  });

  it("holds an IMMEDIATE write lock before invoking the operation", () => {
    const competing = new Database(join(testDirectory, "transactions.sqlite"), { timeout: 1 });

    try {
      runImmediate(createTestContext(), () => {
        expect(() => competing.exec("BEGIN IMMEDIATE")).toThrow(/database is locked/i);
        return undefined;
      });

      expect(() => competing.exec("BEGIN IMMEDIATE")).not.toThrow();
      competing.exec("ROLLBACK");
    } finally {
      competing.close();
    }
  });

  it("passes deterministic transaction-safe dependencies without the publisher", () => {
    const publish = vi.fn();
    const context = createTestContext({ publish });

    const observed = runImmediate(context, (transactionContext) => ({
      now: transactionContext.clock.now(),
      token: transactionContext.tokenFactory(),
      hasPublisher: "eventPublisher" in transactionContext,
      sameDatabase: transactionContext.db === context.db,
      sameSqlite: transactionContext.sqlite === context.sqlite,
    }));

    expect(observed).toEqual({
      now: 1_800_000_000_000,
      token: Buffer.alloc(32, 0x5a),
      hasPublisher: false,
      sameDatabase: true,
      sameSqlite: true,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("createProductionServiceContext", () => {
  it("uses the process connection, keeps the required publisher, and makes 32-byte tokens", () => {
    const publish = vi.fn();
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(testDirectory, "production.sqlite");

    const productionContext = createProductionServiceContext({ publish });

    try {
      expect(productionContext.eventPublisher.publish).toBe(publish);
      expect(productionContext.tokenFactory()).toHaveLength(32);
      expect(productionContext.clock.now()).toEqual(expect.any(Number));
    } finally {
      productionContext.sqlite.close();
      delete (globalThis as typeof globalThis & {
        appointlyDatabaseConnection?: DatabaseConnection;
      }).appointlyDatabaseConnection;
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
    }
  });
});
