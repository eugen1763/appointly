import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { guestSessions } from "../../../db/schema";
import { createGuestTokenDigester } from "../../../lib/security";
import {
  createEnrollmentTestDatabase,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import {
  parseGuestSessionToken,
  resolveOrCreateGuestSession,
  resolveValidGuestSession,
} from "./guest-session";

const YEAR_MS = 31_536_000_000;
const EXISTING_TOKEN = Buffer.alloc(32, 0x31);
const REPLACEMENT_TOKEN = Buffer.alloc(32, 0x32);
const DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x77));

let database: EnrollmentTestDatabase;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
});

afterEach(() => database.close());

function transactionContext(tokenFactory = vi.fn(() => Buffer.from(REPLACEMENT_TOKEN))) {
  return {
    ...database.context,
    tokenFactory,
  };
}

function insertSession(rawToken: Buffer, expiresAt = TEST_NOW + YEAR_MS): Buffer {
  const tokenHash = DIGESTER.digestSessionToken(rawToken);
  database.connection.db.insert(guestSessions).values({
    tokenHash,
    createdAt: TEST_NOW - 5_000,
    lastSeenAt: TEST_NOW - 4_000,
    expiresAt,
  }).run();
  return tokenHash;
}

describe("parseGuestSessionToken", () => {
  it("accepts only the canonical unpadded base64url encoding of 32 bytes", () => {
    const text = EXISTING_TOKEN.toString("base64url");

    expect(parseGuestSessionToken(text)).toEqual(EXISTING_TOKEN);
    for (const malformed of [
      null,
      "",
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)}/`,
      ` ${text}`,
      `${text} `,
    ]) {
      expect(parseGuestSessionToken(malformed)).toBeNull();
    }
  });
});

describe("resolveValidGuestSession", () => {
  it("resolves only a stored session whose fixed expiry is later than now", () => {
    const hash = insertSession(EXISTING_TOKEN);

    expect(resolveValidGuestSession(
      database.context,
      EXISTING_TOKEN.toString("base64url"),
      TEST_NOW,
      DIGESTER,
    )).toEqual({ tokenHash: hash });
    expect(resolveValidGuestSession(
      database.context,
      EXISTING_TOKEN.toString("base64url"),
      TEST_NOW + YEAR_MS,
      DIGESTER,
    )).toBeNull();
    expect(resolveValidGuestSession(database.context, "bad", TEST_NOW, DIGESTER)).toBeNull();
  });
});

describe("resolveOrCreateGuestSession", () => {
  it("creates one session from one safe timestamp and returns its cookie token", () => {
    const clock = vi.fn(() => TEST_NOW);
    const tokenFactory = vi.fn(() => Buffer.from(REPLACEMENT_TOKEN));
    const now = clock();

    const result = resolveOrCreateGuestSession(
      transactionContext(tokenFactory),
      null,
      now,
      DIGESTER,
    );

    const tokenHash = DIGESTER.digestSessionToken(REPLACEMENT_TOKEN);
    expect(result).toEqual({
      tokenHash,
      newSessionToken: REPLACEMENT_TOKEN.toString("base64url"),
    });
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([{
      tokenHash,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + YEAR_MS,
    }]);
    expect(clock).toHaveBeenCalledOnce();
    expect(tokenFactory).toHaveBeenCalledOnce();
  });

  it("reuses a valid session without touching any timestamp or creating a cookie", () => {
    const tokenHash = insertSession(EXISTING_TOKEN);
    const before = database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, tokenHash)).get();
    const tokenFactory = vi.fn(() => {
      throw new Error("valid reuse must not request a token");
    });

    const result = resolveOrCreateGuestSession(
      transactionContext(tokenFactory),
      EXISTING_TOKEN.toString("base64url"),
      TEST_NOW,
      DIGESTER,
    );

    expect(result).toEqual({ tokenHash, newSessionToken: null });
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, tokenHash)).get()).toEqual(before);
    expect(tokenFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "not-a-token"],
    ["unknown", Buffer.alloc(32, 0x44).toString("base64url")],
  ])("replaces a %s cookie", (_label, rawCookie) => {
    const result = resolveOrCreateGuestSession(
      transactionContext(),
      rawCookie,
      TEST_NOW,
      DIGESTER,
    );

    expect(result.newSessionToken).toBe(REPLACEMENT_TOKEN.toString("base64url"));
  });

  it("deletes a presented expired session before creating its fixed-expiry replacement", () => {
    const expiredHash = insertSession(EXISTING_TOKEN, TEST_NOW);

    const result = resolveOrCreateGuestSession(
      transactionContext(),
      EXISTING_TOKEN.toString("base64url"),
      TEST_NOW,
      DIGESTER,
    );

    const replacementHash = DIGESTER.digestSessionToken(REPLACEMENT_TOKEN);
    expect(result).toEqual({
      tokenHash: replacementHash,
      newSessionToken: REPLACEMENT_TOKEN.toString("base64url"),
    });
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, expiredHash)).get()).toBeUndefined();
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, replacementHash)).get()).toEqual({
      tokenHash: replacementHash,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + YEAR_MS,
    });
  });
});
