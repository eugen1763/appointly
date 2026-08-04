import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const temporaryDirectory = path.join(process.cwd(), ".tmp");
const databaseFiles = ["e2e.sqlite", "e2e.sqlite-wal", "e2e.sqlite-shm"];

await mkdir(temporaryDirectory, { recursive: true });
await Promise.all(
  databaseFiles.map((name) => rm(path.join(temporaryDirectory, name), { force: true })),
);
