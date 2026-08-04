import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { eq } from "drizzle-orm";

import {
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  rateLimitWindows,
  responses,
} from "../../../db/schema";
import { createGuestTokenDigester, createRateKeyDigester } from "../../../lib/security";
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
import { PUBLIC_WRITE_RATE_LIMIT } from "./rate-limit";
import { putResponse } from "./responses";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000004";
const SESSION_TOKEN = Buffer.alloc(32, 0x52);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x62));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x72));

let publish: Mock;
let database: EnrollmentTestDatabase;
let appointmentId: string;
let guestParticipantId: string;
let optionId: string;

beforeEach(() => {
  publish = vi.fn();
  database = createEnrollmentTestDatabase({ publish });
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
  guestParticipantId = insertParticipant(database, appointmentId, "Guest");
  optionId = database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId: guestParticipantId,
    startDate: "2030-01-01",
    canonicalKey: "D:2030-01-01",
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
  const sessionTokenHash = TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN);
  database.connection.db.insert(guestSessions).values({
    tokenHash: sessionTokenHash,
    createdAt: TEST_NOW - 1_000,
    expiresAt: TEST_NOW + 10_000,
    lastSeenAt: TEST_NOW - 1_000,
  }).run();
  database.connection.db.insert(guestSessionAccess).values({
    sessionTokenHash,
    participantId: guestParticipantId,
    createdAt: TEST_NOW,
  }).run();
});

afterEach(() => database.close());

function put(
  value: "YES" | "NO" | null,
  overrides: Partial<Parameters<typeof putResponse>[1]> = {},
) {
  return putResponse(database.context, {
    publicId: PUBLIC_ID,
    optionId,
    participantId: guestParticipantId,
    value,
    identity: null,
    guestSessionToken: SESSION_TOKEN.toString("base64url"),
    ...overrides,
  }, TOKEN_DIGESTER, RATE_DIGESTER);
}

function expectAppError(operation: () => unknown, code: string): AppError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code });
    return error as AppError;
  }
  throw new Error(`Expected ${code}`);
}

describe("putResponse", () => {
  it("upserts and clears one guest response with one revision and event per change", () => {
    expect(put("YES")).toEqual({ value: "YES", revision: 2 });
    expect(put("NO")).toEqual({ value: "NO", revision: 3 });
    expect(put(null)).toEqual({ value: null, revision: 4 });

    expect(database.connection.db.select().from(responses).all()).toEqual([]);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(4);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(3);
    expect(publish.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [appointmentId, 2],
      [appointmentId, 3],
      [appointmentId, 4],
    ]);
  });

  it("returns identical puts and absent clears as no-ops without quota or events", () => {
    expect(put(null)).toEqual({ value: null, revision: 1 });
    expect(put("YES")).toEqual({ value: "YES", revision: 2 });
    expect(put("YES")).toEqual({ value: "YES", revision: 2 });

    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("uses the authenticated linked participant and rejects a different body participant", () => {
    insertUser(database, AUTH_USER_ID, "former@example.com", "Former");
    const authenticatedParticipantId = insertParticipant(
      database,
      appointmentId,
      "Former",
      AUTH_USER_ID,
    );

    expect(put("YES", {
      participantId: authenticatedParticipantId,
      identity: { userId: AUTH_USER_ID },
    })).toEqual({ value: "YES", revision: 2 });
    expectAppError(() => put("NO", { identity: { userId: AUTH_USER_ID } }), "FORBIDDEN");

    const rows = database.connection.db.select().from(responses).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.participantId).toBe(authenticatedParticipantId);
  });

  it("lets an unrelated signed-in user use guest-session access", () => {
    insertUser(database, OTHER_USER_ID, "visitor@example.com", "Visitor");

    expect(put("YES", { identity: { userId: OTHER_USER_ID } }))
      .toEqual({ value: "YES", revision: 2 });
  });

  it("returns the same forbidden error for missing, expired, or mismatched guest access", () => {
    const otherParticipantId = insertParticipant(database, appointmentId, "Other");
    expectAppError(() => put("YES", { guestSessionToken: null }), "FORBIDDEN");
    expectAppError(() => put("YES", { participantId: otherParticipantId }), "FORBIDDEN");
    database.connection.db.update(guestSessions).set({ expiresAt: TEST_NOW })
      .where(eq(guestSessions.tokenHash, TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN))).run();
    expectAppError(() => put("YES"), "FORBIDDEN");

    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(database.connection.db.select().from(responses).all()).toEqual([]);
  });

  it("rejects a foreign option and finalized state before consuming quota", () => {
    insertUser(database, OTHER_USER_ID, "other@example.com", "Other");
    const otherAppointmentId = insertAppointment(database, OTHER_USER_ID, "zyxwvutsrqponmlkjihgfedc");
    const otherParticipantId = insertParticipant(database, otherAppointmentId, "Other owner", OTHER_USER_ID);
    const foreignOptionId = database.connection.db.insert(appointmentOptions).values({
      appointmentId: otherAppointmentId,
      creatorParticipantId: otherParticipantId,
      startDate: "2030-01-02",
      canonicalKey: "D:2030-01-02",
      createdAt: TEST_NOW,
    }).returning({ id: appointmentOptions.id }).get().id;

    expectAppError(() => put("YES", { optionId: foreignOptionId }), "NOT_FOUND");
    database.connection.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: optionId,
    }).where(eq(appointments.id, appointmentId)).run();
    expectAppError(() => put("YES"), "APPOINTMENT_FINALIZED");
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
  });

  it("enforces 120 writes per actor and supplies retry timing without changing revision", () => {
    database.connection.db.insert(rateLimitWindows).values({
      key: RATE_DIGESTER.digestRateKey(
        "public-write",
        appointmentId,
        "participant",
        guestParticipantId,
      ),
      count: PUBLIC_WRITE_RATE_LIMIT,
      windowStartedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();

    const error = expectAppError(() => put("YES"), "RATE_LIMITED");

    expect(error.retryAfterSeconds).toBe(60);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(1);
    expect(database.connection.db.select().from(responses).all()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps the committed response when event publication fails", () => {
    publish.mockImplementation(() => {
      throw new Error("subscriber failed");
    });

    expect(put("YES")).toEqual({ value: "YES", revision: 2 });
    expect(database.connection.db.select().from(responses).get()?.value).toBe("YES");
  });
});
