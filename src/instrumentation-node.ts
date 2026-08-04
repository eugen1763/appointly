import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDatabaseConnection } from "./db";

export function registerNodeInstrumentation(): void {
  migrate(getDatabaseConnection().db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
}
