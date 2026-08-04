import { createDatabaseConnection } from "./connection";
import type { DatabaseConnection } from "./connection";

const processState = globalThis as typeof globalThis & {
  appointlyDatabaseConnection?: DatabaseConnection;
};

function getDatabasePath(): string {
  const databasePath = process.env.DATABASE_PATH;
  if (!databasePath?.trim()) {
    throw new Error("DATABASE_PATH is required");
  }
  return databasePath;
}

export function getDatabaseConnection(): DatabaseConnection {
  processState.appointlyDatabaseConnection ??= createDatabaseConnection(getDatabasePath());
  return processState.appointlyDatabaseConnection;
}
