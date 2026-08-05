import { betterAuth } from "better-auth";
import { headers } from "next/headers";
import { describe, expect, it, vi } from "vitest";

const { getSession, insert, onConflictDoNothing, run } = vi.hoisted(() => ({
  getSession: vi.fn(),
  insert: vi.fn(),
  onConflictDoNothing: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@better-auth/drizzle-adapter", () => ({
  drizzleAdapter: vi.fn(() => ({ adapter: "sqlite" })),
}));
vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({ api: { getSession } })),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("../db", () => ({
  getDatabaseConnection: vi.fn(() => ({
    db: { insert },
  })),
}));
vi.mock("./env", () => ({
  getEnv: vi.fn(() => ({
    APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "better-auth-secret",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_AUTH_ENABLED: false,
  })),
}));

import {
  INTERNAL_ORGANIZER_IDENTITY,
  readServerManagerIdentity,
  readServerSession,
} from "./auth";

describe("internal organizer mode", () => {
  it("persists and returns the shared identity without consulting Better Auth", async () => {
    insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: onConflictDoNothing.mockReturnValue({ run }),
      }),
    });

    await expect(readServerSession()).resolves.toMatchObject({
      user: {
        id: INTERNAL_ORGANIZER_IDENTITY.userId,
        email: INTERNAL_ORGANIZER_IDENTITY.email,
        name: INTERNAL_ORGANIZER_IDENTITY.name,
      },
    });
    await expect(readServerManagerIdentity()).resolves.toEqual(
      INTERNAL_ORGANIZER_IDENTITY,
    );

    expect(insert).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    expect(headers).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
    expect(betterAuth).toHaveBeenCalledOnce();
  });
});