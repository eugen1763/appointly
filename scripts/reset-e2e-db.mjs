import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const temporaryDirectory = path.join(process.cwd(), ".tmp");
const buildDirectory = path.join(process.cwd(), ".next");
const databaseFiles = ["e2e.sqlite", "e2e.sqlite-wal", "e2e.sqlite-shm"];

await mkdir(temporaryDirectory, { recursive: true });
await Promise.all(
  databaseFiles.map((name) => rm(path.join(temporaryDirectory, name), { force: true })),
);

/* A killed run leaves .next/dev/lock behind and the cache it guards half-written, so
   the next dev server fails on its own build data ("Failed to restore task data",
   "Invalid block type", "read ECONNRESET") and the suite reports product defects that
   are not there. Only this pre-step clears it: `npm run dev` keeps its warm cache. */
await rm(buildDirectory, { force: true, recursive: true });
