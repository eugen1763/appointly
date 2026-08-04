import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  database: { kind: "test-database" },
  getDatabaseConnection: vi.fn(),
  migrate: vi.fn(),
}));

vi.mock("./db", () => ({
  getDatabaseConnection: fakes.getDatabaseConnection,
}));

vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({
  migrate: fakes.migrate,
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  fakes.getDatabaseConnection.mockReset();
  fakes.getDatabaseConnection.mockReturnValue({ db: fakes.database });
  fakes.migrate.mockReset();
});

describe("instrumentation registration", () => {
  it("runs the synchronous migrator once with the checked-in migration folder in Node", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await import("./instrumentation");

    await register();

    expect(fakes.getDatabaseConnection).toHaveBeenCalledOnce();
    expect(fakes.migrate).toHaveBeenCalledOnce();
    expect(fakes.migrate).toHaveBeenCalledWith(fakes.database, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
  });

  it("does not open the database or run migrations outside the Node runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("./instrumentation");

    await register();

    expect(fakes.getDatabaseConnection).not.toHaveBeenCalled();
    expect(fakes.migrate).not.toHaveBeenCalled();
  });
});
