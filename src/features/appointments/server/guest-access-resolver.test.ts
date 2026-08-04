import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../db/schema";
import { createGuestTokenDigester, type GuestTokenDigester } from "../../../lib/security";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertUser,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import { resolveLinkedGuestAccess } from "./guest-session";

const OTHER_OWNER_ID = "00000000-0000-4000-8000-000000000009";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const EARLY_ID = "00000000-0000-4000-8000-000000000101";
const SAME_TIME_FIRST_ID = "00000000-0000-4000-8000-000000000102";
const SAME_TIME_SECOND_ID = "00000000-0000-4000-8000-000000000103";
const OTHER_APPOINTMENT_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000104";
const RAW_TOKEN = Buffer.alloc(32, 0x61);
const RAW_TOKEN_TEXT = RAW_TOKEN.toString("base64url");
const DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x75));
const SESSION_HASH = DIGESTER.digestSessionToken(RAW_TOKEN);

let database: EnrollmentTestDatabase;
let appointmentId: string;
let otherAppointmentId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, OTHER_OWNER_ID, "other-owner@example.com", "Other owner");
  appointmentId = insertAppointment(database);
  otherAppointmentId = insertAppointment(database, OTHER_OWNER_ID, OTHER_PUBLIC_ID);
  database.connection.db.insert(participants).values([
    {
      id: SAME_TIME_SECOND_ID,
      appointmentId,
      displayName: "Same second",
      normalizedName: "same second",
      createdAt: TEST_NOW - 1_000,
      updatedAt: TEST_NOW,
    },
    {
      id: EARLY_ID,
      appointmentId,
      displayName: "Early",
      normalizedName: "early",
      createdAt: TEST_NOW - 2_000,
      updatedAt: TEST_NOW,
    },
    {
      id: SAME_TIME_FIRST_ID,
      appointmentId,
      displayName: "Same first",
      normalizedName: "same first",
      createdAt: TEST_NOW - 1_000,
      updatedAt: TEST_NOW,
    },
    {
      id: OTHER_APPOINTMENT_PARTICIPANT_ID,
      appointmentId: otherAppointmentId,
      displayName: "Other appointment",
      normalizedName: "other appointment",
      createdAt: TEST_NOW - 3_000,
      updatedAt: TEST_NOW,
    },
  ]).run();
  database.connection.db.insert(guestSessions).values({
    tokenHash: SESSION_HASH,
    createdAt: TEST_NOW - 10_000,
    lastSeenAt: TEST_NOW - 9_000,
    expiresAt: TEST_NOW + 10_000,
  }).run();
  database.connection.db.insert(guestSessionAccess).values([
    { sessionTokenHash: SESSION_HASH, participantId: SAME_TIME_SECOND_ID, createdAt: TEST_NOW },
    { sessionTokenHash: SESSION_HASH, participantId: OTHER_APPOINTMENT_PARTICIPANT_ID, createdAt: TEST_NOW },
    { sessionTokenHash: SESSION_HASH, participantId: SAME_TIME_FIRST_ID, createdAt: TEST_NOW },
    { sessionTokenHash: SESSION_HASH, participantId: EARLY_ID, createdAt: TEST_NOW },
  ]).run();
});

afterEach(() => database.close());

function contextAt(now: number) {
  return { ...database.context, clock: { now: vi.fn(() => now) } };
}

describe("resolveLinkedGuestAccess", () => {
  it("returns only this appointment's linked identities in participant creation order", () => {
    const before = database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, SESSION_HASH)).get();

    const result = resolveLinkedGuestAccess(
      contextAt(TEST_NOW),
      PUBLIC_ID,
      RAW_TOKEN_TEXT,
      DIGESTER,
    );

    expect(result).toEqual([
      { participantId: EARLY_ID, displayName: "Early" },
      { participantId: SAME_TIME_FIRST_ID, displayName: "Same first" },
      { participantId: SAME_TIME_SECOND_ID, displayName: "Same second" },
    ]);
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, SESSION_HASH)).get()).toEqual(before);
  });

  it.each([
    ["absent", null, TEST_NOW],
    ["malformed", "bad", TEST_NOW],
    ["unknown", Buffer.alloc(32, 0x62).toString("base64url"), TEST_NOW],
    ["expired", RAW_TOKEN_TEXT, TEST_NOW + 10_000],
  ])("returns no access for an %s session", (_label, rawCookie, now) => {
    expect(resolveLinkedGuestAccess(contextAt(now), PUBLIC_ID, rawCookie, DIGESTER)).toEqual([]);
  });

  it("does not delete an expired session or its access during read-only resolution", () => {
    const sessionBefore = database.connection.db.select().from(guestSessions).all();
    const accessBefore = database.connection.db.select().from(guestSessionAccess).all();

    expect(resolveLinkedGuestAccess(
      contextAt(TEST_NOW + 10_000),
      PUBLIC_ID,
      RAW_TOKEN_TEXT,
      DIGESTER,
    )).toEqual([]);

    expect(database.connection.db.select().from(guestSessions).all()).toEqual(sessionBefore);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual(accessBefore);
  });

  it("reflects access and session deletion without stale selectable identities", () => {
    database.connection.db.delete(guestSessionAccess).where(eq(
      guestSessionAccess.participantId,
      EARLY_ID,
    )).run();
    expect(resolveLinkedGuestAccess(contextAt(TEST_NOW), PUBLIC_ID, RAW_TOKEN_TEXT, DIGESTER))
      .not.toContainEqual({ participantId: EARLY_ID, displayName: "Early" });

    database.connection.db.delete(guestSessions)
      .where(eq(guestSessions.tokenHash, SESSION_HASH)).run();
    expect(resolveLinkedGuestAccess(contextAt(TEST_NOW), PUBLIC_ID, RAW_TOKEN_TEXT, DIGESTER))
      .toEqual([]);
  });

  it("does not invoke token hashing for a malformed cookie", () => {
    const tokenDigester: GuestTokenDigester = {
      digestEditToken: vi.fn(),
      digestSessionToken: vi.fn(() => { throw new Error("must not run"); }),
    };

    expect(resolveLinkedGuestAccess(contextAt(TEST_NOW), PUBLIC_ID, "bad", tokenDigester))
      .toEqual([]);
    expect(tokenDigester.digestSessionToken).not.toHaveBeenCalled();
  });

  it("maps an unexpected runtime fault to one generic internal error", () => {
    const tokenDigester: GuestTokenDigester = {
      digestEditToken: vi.fn(),
      digestSessionToken: vi.fn(() => { throw new Error("secret resolver fault"); }),
    };

    let thrown: unknown;
    try {
      resolveLinkedGuestAccess(contextAt(TEST_NOW), PUBLIC_ID, RAW_TOKEN_TEXT, tokenDigester);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Could not resolve guest access.",
    });
    expect((thrown as Error).message).not.toContain("secret resolver fault");
  });
});
