import { describe, expect, it } from "vitest";

import { AppError } from "../features/appointments/http-errors";
import { extractManagerIdentity } from "./auth-session";

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

describe("extractManagerIdentity", () => {
  it.each([
    { session: null, label: "a null session" },
    {
      session: { ...validSession, user: { ...validSession.user, email: "   " } },
      label: "a blank email",
    },
  ])("rejects $label with the shared unauthenticated app error", ({ session }) => {
    let thrown: unknown;

    try {
      extractManagerIdentity(session);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("returns only manager identity fields and trims the required email", () => {
    const providerSession = {
      ...validSession,
      user: { ...validSession.user, email: "  manager@example.com  " },
      account: { providerId: "google", accessToken: "must-not-leak" },
    };
    expect(extractManagerIdentity(providerSession)).toEqual({
      userId: "user-id",
      email: "manager@example.com",
      name: "Manager Name",
    });
  });
});

