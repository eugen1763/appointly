import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { applicationDb, databaseAdapter, getSession, readHeaders } = vi.hoisted(() => ({
  applicationDb: {},
  databaseAdapter: { adapter: "sqlite" },
  getSession: vi.fn(),
  readHeaders: vi.fn(),
}));

vi.mock("@better-auth/drizzle-adapter", () => ({
  drizzleAdapter: vi.fn(() => databaseAdapter),
}));
vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({ api: { getSession } })),
}));
vi.mock("next/headers", () => ({ headers: readHeaders }));
vi.mock("../db", () => ({
  getDatabaseConnection: vi.fn(() => ({ db: applicationDb })),
}));
vi.mock("./env", () => ({
  getEnv: vi.fn(() => ({
    APP_URL: "https://appointments.example",
    BETTER_AUTH_SECRET: "better-auth-secret",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_AUTH_ENABLED: true,
  })),
}));
import { authDatabaseSchema } from "./auth-config";

import { readServerManagerIdentity, readServerSession } from "./auth";

const validSession = {
  session: {
    id: "session-id",
    token: "session-token",
    userId: "user-id",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    createdAt: new Date("2029-01-01T00:00:00.000Z"),
    updatedAt: new Date("2029-01-01T00:00:00.000Z"),
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: "user-id",
    email: "manager@example.com",
    name: "Manager Name",
    emailVerified: true,
    image: null,
    createdAt: new Date("2029-01-01T00:00:00.000Z"),
    updatedAt: new Date("2029-01-01T00:00:00.000Z"),
  },
};

beforeEach(() => {
  getSession.mockReset();
  readHeaders.mockReset();
});

describe("auth composition", () => {
  it("passes only the four auth tables to the SQLite adapter and exact options to Better Auth", () => {
    expect(drizzleAdapter).toHaveBeenCalledWith(applicationDb, {
      provider: "sqlite",
      schema: authDatabaseSchema,
    });
    const adapterConfig = vi.mocked(drizzleAdapter).mock.calls[0]?.[1];
    expect(Object.keys(adapterConfig?.schema ?? {})).toEqual([
      "user",
      "session",
      "account",
      "verification",
    ]);
    expect(betterAuth).toHaveBeenCalledWith({
      baseURL: "https://appointments.example",
      secret: "better-auth-secret",
      trustedOrigins: ["https://appointments.example"],
      database: databaseAdapter,
      socialProviders: {
        google: {
          clientId: "google-client-id",
          clientSecret: "google-client-secret",
        },
      },
      emailAndPassword: { enabled: false },
      advanced: { useSecureCookies: true },
    });
  });
});

describe("server session readers", () => {
  it("gets the Better Auth session with awaited Next request headers", async () => {
    const requestHeaders = new Headers({ cookie: "better-auth.session_token=value" });
    readHeaders.mockResolvedValue(requestHeaders);
    getSession.mockResolvedValue(validSession);

    await expect(readServerSession()).resolves.toEqual(validSession);
    expect(getSession).toHaveBeenCalledWith({ headers: requestHeaders });
  });

  it("composes session reading with manager identity extraction", async () => {
    readHeaders.mockResolvedValue(new Headers());
    getSession.mockResolvedValue(validSession);

    await expect(readServerManagerIdentity()).resolves.toEqual({
      userId: "user-id",
      email: "manager@example.com",
      name: "Manager Name",
    });
  });

  it("rejects a missing server session as unauthenticated", async () => {
    readHeaders.mockResolvedValue(new Headers());
    getSession.mockResolvedValue(null);

    await expect(readServerManagerIdentity()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});
