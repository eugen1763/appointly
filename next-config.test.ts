import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config", () => {
  it("allows development assets from the configured application host", async () => {
    vi.stubEnv("APP_URL", "http://192.168.1.122:3000");

    const { default: config } = await import("./next.config");

    expect(config.allowedDevOrigins).toEqual(["192.168.1.122"]);
  });
});
