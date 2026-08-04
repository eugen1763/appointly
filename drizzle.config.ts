import { defineConfig } from "drizzle-kit";

const databasePath = process.env.DATABASE_PATH;
if (!databasePath?.trim()) {
  throw new Error("DATABASE_PATH is required");
}

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/db/auth-schema.ts", "./src/db/schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: databasePath,
  },
});
