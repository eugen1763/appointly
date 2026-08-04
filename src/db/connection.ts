import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as appointmentSchema from "./schema";
import * as authSchema from "./auth-schema";

export const databaseSchema = {
  ...authSchema,
  ...appointmentSchema,
};

export type AppDatabase = BetterSQLite3Database<typeof databaseSchema>;
export interface DatabaseConnection {
  readonly sqlite: Database.Database;
  readonly db: AppDatabase;
}

export function createDatabaseConnection(databasePath: string): DatabaseConnection {
  let sqlite: Database.Database | undefined;

  try {
    sqlite = new Database(databasePath, { timeout: 5_000 });

    const journalMode = sqlite.pragma("journal_mode = WAL", { simple: true });
    if (journalMode !== "wal") {
      throw new Error(`SQLite WAL mode is required; received ${String(journalMode)}`);
    }

    sqlite.pragma("foreign_keys = ON");

    return {
      sqlite,
      db: drizzle(sqlite, { schema: databaseSchema }),
    };
  } catch (error) {
    sqlite?.close();
    throw error;
  }
}
