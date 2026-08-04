import { describe, expect, it } from "vitest";

import {
  createGuestSessionTimestamps,
  serializeGuestSessionCookie,
} from "./guest-session-storage";

const now = 1_800_000_000_000;

describe("guest session storage timestamps", () => {
  it("derives exact fixed 365-day expiry from one injected time", () => {
    expect(createGuestSessionTimestamps(now)).toEqual({
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 31_536_000_000,
    });
  });

  it("rejects a fixed expiry outside the safe integer range", () => {
    expect(() => createGuestSessionTimestamps(Number.MAX_SAFE_INTEGER - 1))
      .toThrow(RangeError);
  });
});

describe("guest session cookie", () => {
  const token = Buffer.alloc(32, 0xa5).toString("base64url");

  it("serializes the exact HTTPS-only server cookie", () => {
    expect(serializeGuestSessionCookie(token, "https://appointments.example")).toBe(
      `appointly_guest_session=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("serializes the exact HTTP server cookie without Secure", () => {
    expect(serializeGuestSessionCookie(token, "http://127.0.0.1:3000")).toBe(
      `appointly_guest_session=${token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );
  });

  it.each(["", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}+`])(
    "refuses to serialize a non-canonical token %j",
    (invalidToken) => {
      expect(() => serializeGuestSessionCookie(invalidToken, "https://appointments.example"))
        .toThrow(RangeError);
    },
  );
});
