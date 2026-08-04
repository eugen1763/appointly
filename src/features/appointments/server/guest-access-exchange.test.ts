import type * as CryptoModule from "node:crypto";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { compareCalls } = vi.hoisted(() => ({
  compareCalls: [] as Array<{ candidate: Buffer; stored: Buffer }>,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return {
    ...actual,
    timingSafeEqual(candidate: NodeJS.ArrayBufferView, stored: NodeJS.ArrayBufferView) {
      compareCalls.push({
        candidate: Buffer.from(candidate.buffer, candidate.byteOffset, candidate.byteLength),
        stored: Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength),
      });
      return actual.timingSafeEqual(candidate, stored);
    },
  };
});

import {
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../db/schema";
import {
  createGuestTokenDigester,
  type GuestTokenDigester,
} from "../../../lib/security";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertParticipant,
  insertUser,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import { exchangeGuestAccess } from "./guest-access";
import type { ServiceContext } from "./service-context";

const EDIT_TOKEN = Buffer.alloc(32, 0x31);
const WRONG_EDIT_TOKEN = Buffer.alloc(32, 0x32);
const NEW_SESSION_TOKEN = Buffer.alloc(32, 0x41);
const VALID_SESSION_TOKEN = Buffer.alloc(32, 0x42);
const EXPIRED_SESSION_TOKEN = Buffer.alloc(32, 0x43);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x6f));
const YEAR_MS = 31_536_000_000;
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";

let database: EnrollmentTestDatabase;
let appointmentId: string;
let participantId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
  participantId = insertParticipant(database, appointmentId, "Avery");
  database.connection.db.update(participants)
    .set({ editTokenHash: TOKEN_DIGESTER.digestEditToken(EDIT_TOKEN) })
    .where(eq(participants.id, participantId))
    .run();
  compareCalls.length = 0;
});

afterEach(() => database.close());

function context(
  token = NEW_SESSION_TOKEN,
  now = vi.fn(() => TEST_NOW),
): ServiceContext {
  return {
    ...database.context,
    clock: { now },
    tokenFactory: () => Buffer.from(token),
  };
}

function exchange(
  overrides: Partial<Parameters<typeof exchangeGuestAccess>[1]> = {},
  serviceContext = context(),
  tokenDigester: GuestTokenDigester = TOKEN_DIGESTER,
) {
  return exchangeGuestAccess(serviceContext, {
    publicId: PUBLIC_ID,
    participantId,
    token: EDIT_TOKEN.toString("base64url"),
    guestSessionToken: null,
    ...overrides,
  }, tokenDigester);
}

function expectError(
  operation: () => unknown,
  code: "INVALID_EDIT_LINK" | "INTERNAL_ERROR",
  message: string,
): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code, message });
}

function storeSession(
  rawToken: Buffer,
  values: { createdAt: number; lastSeenAt: number; expiresAt: number },
): Buffer {
  const tokenHash = TOKEN_DIGESTER.digestSessionToken(rawToken);
  database.connection.db.insert(guestSessions).values({ tokenHash, ...values }).run();
  return tokenHash;
}

function allGuestRows() {
  return {
    sessions: database.connection.db.select().from(guestSessions).all(),
    access: database.connection.db.select().from(guestSessionAccess).all(),
  };
}

describe("exchangeGuestAccess", () => {
  it.each([
    ["malformed public ID", { publicId: "bad" }],
    ["malformed participant ID", { participantId: "bad" }],
    ["malformed token alphabet", { token: "!".repeat(43) }],
    ["malformed token length", { token: "A".repeat(42) }],
    ["noncanonical token", { token: "_".repeat(43) }],
    ["missing appointment", { publicId: "ABCDEFGHIJKLMNOPQRSTUVWX" }],
    ["missing participant", { participantId: "00000000-0000-4000-8000-000000000999" }],
    ["wrong token", { token: WRONG_EDIT_TOKEN.toString("base64url") }],
  ])("returns the one fixed invalid result for %s after one fixed-length compare", (_case, overrides) => {
    expectError(
      () => exchange(overrides),
      "INVALID_EDIT_LINK",
      "This private edit link is invalid or no longer available.",
    );

    expect(compareCalls).toHaveLength(1);
    expect(compareCalls[0]?.candidate).toHaveLength(32);
    expect(compareCalls[0]?.stored).toHaveLength(32);
    expect(allGuestRows()).toEqual({ sessions: [], access: [] });
  });

  it("uses the dummy digest for a missing edit digest", () => {
    database.connection.db.update(participants)
      .set({ editTokenHash: null })
      .where(eq(participants.id, participantId))
      .run();

    expectError(
      () => exchange(),
      "INVALID_EDIT_LINK",
      "This private edit link is invalid or no longer available.",
    );

    expect(compareCalls).toHaveLength(1);
    expect(compareCalls[0]?.stored).toEqual(Buffer.alloc(32));
  });

  it("does not accept a participant from a different appointment", () => {
    const otherAppointmentId = insertAppointment(database, OWNER_USER_ID, OTHER_PUBLIC_ID);
    const otherParticipantId = insertParticipant(database, otherAppointmentId, "Blair");
    database.connection.db.update(participants)
      .set({ editTokenHash: TOKEN_DIGESTER.digestEditToken(EDIT_TOKEN) })
      .where(eq(participants.id, otherParticipantId))
      .run();

    expectError(
      () => exchange({ participantId: otherParticipantId }),
      "INVALID_EDIT_LINK",
      "This private edit link is invalid or no longer available.",
    );
    expect(compareCalls).toHaveLength(1);
    expect(compareCalls[0]?.stored).toEqual(Buffer.alloc(32));
  });

  it("creates one fixed session, access row, and exact success in one transaction", () => {
    const clock = vi.fn(() => TEST_NOW);

    const result = exchange({}, context(NEW_SESSION_TOKEN, clock));

    const sessionHash = TOKEN_DIGESTER.digestSessionToken(NEW_SESSION_TOKEN);
    expect(result).toEqual({
      participantId,
      sessionToken: NEW_SESSION_TOKEN.toString("base64url"),
    });
    expect(clock).toHaveBeenCalledOnce();
    expect(compareCalls).toHaveLength(1);
    expect(allGuestRows()).toEqual({
      sessions: [{
        tokenHash: sessionHash,
        createdAt: TEST_NOW,
        expiresAt: TEST_NOW + YEAR_MS,
        lastSeenAt: TEST_NOW,
      }],
      access: [{
        sessionTokenHash: sessionHash,
        participantId,
        createdAt: TEST_NOW,
      }],
    });
  });

  it("reuses a valid session, preserves fixed times, upserts access, and touches only lastSeenAt", () => {
    const sessionHash = storeSession(VALID_SESSION_TOKEN, {
      createdAt: TEST_NOW - 10_000,
      expiresAt: TEST_NOW + 20_000,
      lastSeenAt: TEST_NOW - 5_000,
    });
    const tokenFactory = vi.fn(() => { throw new Error("must not create a token"); });
    const serviceContext: ServiceContext = { ...database.context, tokenFactory };

    const first = exchange({
      guestSessionToken: VALID_SESSION_TOKEN.toString("base64url"),
    }, serviceContext);
    const accessCreatedAt = database.connection.db.select().from(guestSessionAccess).get()?.createdAt;
    const secondNow = TEST_NOW + 100;
    const second = exchange({
      guestSessionToken: VALID_SESSION_TOKEN.toString("base64url"),
    }, {
      ...serviceContext,
      clock: { now: () => secondNow },
    });

    expect(first).toEqual({ participantId, sessionToken: null });
    expect(second).toEqual({ participantId, sessionToken: null });
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([{
      tokenHash: sessionHash,
      createdAt: TEST_NOW - 10_000,
      expiresAt: TEST_NOW + 20_000,
      lastSeenAt: secondNow,
    }]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([{
      sessionTokenHash: sessionHash,
      participantId,
      createdAt: accessCreatedAt,
    }]);
  });

  it("replaces an expired session and cascades its old access", () => {
    const expiredHash = storeSession(EXPIRED_SESSION_TOKEN, {
      createdAt: TEST_NOW - YEAR_MS,
      expiresAt: TEST_NOW,
      lastSeenAt: TEST_NOW - 10,
    });
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: expiredHash,
      participantId,
      createdAt: TEST_NOW - 20,
    }).run();

    const result = exchange({
      guestSessionToken: EXPIRED_SESSION_TOKEN.toString("base64url"),
    });

    const newHash = TOKEN_DIGESTER.digestSessionToken(NEW_SESSION_TOKEN);
    expect(result).toEqual({
      participantId,
      sessionToken: NEW_SESSION_TOKEN.toString("base64url"),
    });
    expect(allGuestRows()).toEqual({
      sessions: [{
        tokenHash: newHash,
        createdAt: TEST_NOW,
        expiresAt: TEST_NOW + YEAR_MS,
        lastSeenAt: TEST_NOW,
      }],
      access: [{
        sessionTokenHash: newHash,
        participantId,
        createdAt: TEST_NOW,
      }],
    });
  });

  it("rolls back expired replacement, access, and lastSeen when a late SQLite write fails", () => {
    const expiredHash = storeSession(EXPIRED_SESSION_TOKEN, {
      createdAt: TEST_NOW - YEAR_MS,
      expiresAt: TEST_NOW,
      lastSeenAt: TEST_NOW - 10,
    });
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: expiredHash,
      participantId,
      createdAt: TEST_NOW - 20,
    }).run();
    const before = allGuestRows();
    database.connection.sqlite.exec(`
      CREATE TRIGGER fail_exchange_touch
      BEFORE UPDATE OF last_seen_at ON guest_sessions
      BEGIN
        SELECT RAISE(ABORT, 'forced late exchange failure');
      END
    `);

    expectError(
      () => exchange({
        guestSessionToken: EXPIRED_SESSION_TOKEN.toString("base64url"),
      }),
      "INTERNAL_ERROR",
      "Could not open the private edit link.",
    );
    expect(allGuestRows()).toEqual(before);
  });

  it.each([
    ["clock", () => ({ clock: { now: () => { throw new Error("clock secret"); } } })],
    ["HMAC", () => ({ tokenDigester: {
      digestEditToken() { throw new Error("hmac secret"); },
      digestSessionToken: TOKEN_DIGESTER.digestSessionToken,
    } satisfies GuestTokenDigester })],
  ])("maps an unexpected %s fault to the one safe internal error", (_case, setup) => {
    const fault = setup();
    expectError(
      () => exchange(
        {},
        "clock" in fault ? { ...context(), ...fault } : context(),
        "tokenDigester" in fault ? fault.tokenDigester : TOKEN_DIGESTER,
      ),
      "INTERNAL_ERROR",
      "Could not open the private edit link.",
    );
    expect(allGuestRows()).toEqual({ sessions: [], access: [] });
  });
});
