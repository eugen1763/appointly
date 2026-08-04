import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { eq } from "drizzle-orm";

import {
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
  rateLimitWindows,
  responses,
} from "../../../db/schema";
import {
  createDeleteConfirmationDigester,
  createGuestTokenDigester,
  createRateKeyDigester,
  type DeleteConfirmationDigester,
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
import { deleteOption, type DeleteOptionInput } from "./options";
import { PUBLIC_WRITE_RATE_LIMIT } from "./rate-limit";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000003";
const VISITOR_USER_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const SESSION_TOKEN = Buffer.alloc(32, 0x36);
const SESSION_TOKEN_VALUE = SESSION_TOKEN.toString("base64url");
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x46));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x56));
const CONFIRMATION_DIGESTER = createDeleteConfirmationDigester(Buffer.alloc(32, 0x66));

let publish: Mock;
let database: EnrollmentTestDatabase;
let appointmentId: string;
let creatorParticipantId: string;

beforeEach(() => {
  publish = vi.fn();
  database = createEnrollmentTestDatabase({ publish });
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
  creatorParticipantId = insertParticipant(database, appointmentId, "Creator");
  grantGuestAccess(creatorParticipantId);
});

afterEach(() => database.close());

function grantGuestAccess(participantId: string, token: Buffer = SESSION_TOKEN): void {
  const tokenHash = TOKEN_DIGESTER.digestSessionToken(token);
  database.connection.db.insert(guestSessions).values({
    tokenHash,
    createdAt: TEST_NOW - 1_000,
    expiresAt: TEST_NOW + 60_000,
    lastSeenAt: TEST_NOW - 1_000,
  }).onConflictDoNothing().run();
  database.connection.db.insert(guestSessionAccess).values({
    sessionTokenHash: tokenHash,
    participantId,
    createdAt: TEST_NOW,
  }).onConflictDoNothing().run();
}

function insertOption(
  creator = creatorParticipantId,
  targetAppointmentId = appointmentId,
  canonicalKey = "D:2030-01-15",
): string {
  return database.connection.db.insert(appointmentOptions).values({
    appointmentId: targetAppointmentId,
    creatorParticipantId: creator,
    startDate: canonicalKey.slice(2),
    canonicalKey,
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
}

function insertFixedParticipant(id: string, displayName: string): string {
  database.connection.db.insert(participants).values({
    id,
    appointmentId,
    userId: null,
    displayName,
    normalizedName: displayName.toLowerCase(),
    editTokenHash: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  }).run();
  return id;
}

function respond(optionId: string, participantId: string, value: "YES" | "NO" = "YES"): void {
  database.connection.db.insert(responses).values({
    appointmentId,
    participantId,
    optionId,
    value,
    updatedAt: TEST_NOW,
  }).run();
}

function remove(
  optionId: string,
  overrides: Partial<DeleteOptionInput> = {},
  confirmationDigester: DeleteConfirmationDigester = CONFIRMATION_DIGESTER,
) {
  return deleteOption(database.context, {
    publicId: PUBLIC_ID,
    optionId,
    participantId: creatorParticipantId,
    identity: null,
    guestSessionToken: SESSION_TOKEN_VALUE,
    ...overrides,
  }, TOKEN_DIGESTER, RATE_DIGESTER, confirmationDigester);
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

function confirmationToken(optionId: string): string {
  const error = expectAppError(() => remove(optionId), "DELETE_CONFIRMATION_REQUIRED");
  return String(error.details?.token);
}

function storedRevision(): number | undefined {
  return database.connection.db.select({ revision: appointments.revision })
    .from(appointments).where(eq(appointments.id, appointmentId)).get()?.revision;
}

describe("deleteOption", () => {
  it("deletes a zero-YES guest-owned option, consumes one unit, revises once, and publishes after commit", () => {
    const optionId = insertOption();
    const digestDeleteConfirmation = vi.fn(() => Buffer.alloc(32));
    const observations: Array<{ optionCount: number; revision: number | undefined }> = [];
    publish.mockImplementation(() => {
      observations.push({
        optionCount: database.connection.db.select().from(appointmentOptions).all().length,
        revision: storedRevision(),
      });
    });

    expect(remove(optionId, {}, { digestDeleteConfirmation })).toEqual({ revision: 2 });

    expect(database.connection.db.select().from(appointmentOptions).all()).toEqual([]);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
    expect(digestDeleteConfirmation).not.toHaveBeenCalled();
    expect(observations).toEqual([{ optionCount: 0, revision: 2 }]);
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("resolves authenticated actors and lets unrelated signed-in visitors fall back to guest access", () => {
    insertUser(database, AUTH_USER_ID, "actor@example.com", "Actor");
    const authenticatedParticipantId = insertParticipant(database, appointmentId, "Authenticated", AUTH_USER_ID);
    const authenticatedOptionId = insertOption(authenticatedParticipantId, appointmentId, "D:2030-01-16");

    expect(remove(authenticatedOptionId, {
      participantId: authenticatedParticipantId,
      identity: { userId: AUTH_USER_ID },
      guestSessionToken: null,
    })).toEqual({ revision: 2 });

    insertUser(database, VISITOR_USER_ID, "visitor@example.com", "Visitor");
    const guestOptionId = insertOption();
    expect(remove(guestOptionId, { identity: { userId: VISITOR_USER_ID } })).toEqual({ revision: 3 });
    expect(database.connection.db.select().from(rateLimitWindows).all()).toHaveLength(2);
  });

  it("rejects non-creators and cross-appointment option IDs without quota or writes", () => {
    const optionId = insertOption();
    const otherParticipantId = insertParticipant(database, appointmentId, "Other");
    grantGuestAccess(otherParticipantId);

    expectAppError(() => remove(optionId, { participantId: otherParticipantId }), "FORBIDDEN");

    const otherAppointmentId = insertAppointment(database, OWNER_USER_ID, OTHER_PUBLIC_ID);
    const foreignParticipantId = insertParticipant(database, otherAppointmentId, "Foreign");
    const foreignOptionId = insertOption(foreignParticipantId, otherAppointmentId, "D:2030-01-16");
    expectAppError(() => remove(foreignOptionId), "NOT_FOUND");

    expect(database.connection.db.select().from(appointmentOptions).all()).toHaveLength(2);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(storedRevision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects finalized appointments after actor resolution and before quota or deletion", () => {
    const optionId = insertOption();
    database.connection.db.update(appointments).set({ status: "FINALIZED", finalOptionId: optionId })
      .where(eq(appointments.id, appointmentId)).run();

    expectAppError(() => remove(optionId), "APPOINTMENT_FINALIZED");
    expectAppError(() => remove(optionId, { guestSessionToken: null }), "FORBIDDEN");

    expect(database.connection.db.select().from(appointmentOptions).all()).toHaveLength(1);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(storedRevision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns sorted YES names and a digest of appointment, option, and sorted participant IDs without quota", () => {
    const optionId = insertOption();
    const laterId = insertFixedParticipant("00000000-0000-4000-8000-000000000020", "Zoe");
    const earlierId = insertFixedParticipant("00000000-0000-4000-8000-000000000010", "Avery");
    const noId = insertFixedParticipant("00000000-0000-4000-8000-000000000030", "No response");
    respond(optionId, laterId);
    respond(optionId, earlierId);
    respond(optionId, noId, "NO");
    const digestParts: string[][] = [];
    const digest = Buffer.alloc(32, 0x7a);
    const digester: DeleteConfirmationDigester = {
      digestDeleteConfirmation(...parts) {
        digestParts.push([...parts]);
        return digest;
      },
    };

    const error = expectAppError(() => remove(optionId, {}, digester), "DELETE_CONFIRMATION_REQUIRED");

    expect(error.details).toEqual({ count: 2, names: ["Avery", "Zoe"], token: digest.toString("base64url") });
    expect(digestParts).toEqual([[appointmentId, optionId, earlierId, laterId]]);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(storedRevision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns fresh stale details for malformed and mismatched tokens, then accepts the current token", () => {
    const optionId = insertOption();
    respond(optionId, creatorParticipantId);
    const token = confirmationToken(optionId);

    for (const staleToken of ["malformed", Buffer.alloc(32, 0x7f).toString("base64url")]) {
      const error = expectAppError(() => remove(optionId, { confirmationToken: staleToken }), "STALE_DELETE_CONFIRMATION");
      expect(error.details).toEqual({ count: 1, names: ["Creator"], token });
    }
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(storedRevision()).toBe(1);

    expect(remove(optionId, { confirmationToken: token })).toEqual({ revision: 2 });
    expect(database.connection.db.select().from(appointmentOptions).all()).toEqual([]);
    expect(database.connection.db.select().from(responses).all()).toEqual([]);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("invalidates confirmation when the current YES participant set changes", () => {
    const optionId = insertOption();
    const firstParticipantId = insertFixedParticipant(
      "00000000-0000-4000-8000-000000000050",
      "First",
    );
    respond(optionId, firstParticipantId);
    const oldToken = confirmationToken(optionId);
    const secondParticipantId = insertFixedParticipant("00000000-0000-4000-8000-000000000040", "Second");
    respond(optionId, secondParticipantId);

    const stale = expectAppError(() => remove(optionId, { confirmationToken: oldToken }), "STALE_DELETE_CONFIRMATION");

    expect(stale.details).toMatchObject({ count: 2, names: ["Second", "First"] });
    expect(stale.details?.token).not.toBe(oldToken);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(storedRevision()).toBe(1);

    expect(remove(optionId, { confirmationToken: String(stale.details?.token) })).toEqual({ revision: 2 });
  });

  it("checks confirmation before quota and consumes quota only for an authorized deletion attempt", () => {
    const optionId = insertOption();
    respond(optionId, creatorParticipantId);
    const rateKey = RATE_DIGESTER.digestRateKey("public-write", appointmentId, "participant", creatorParticipantId);
    database.connection.db.insert(rateLimitWindows).values({
      key: rateKey,
      count: PUBLIC_WRITE_RATE_LIMIT,
      windowStartedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();

    const required = expectAppError(() => remove(optionId), "DELETE_CONFIRMATION_REQUIRED");
    expectAppError(
      () => remove(optionId, { confirmationToken: Buffer.alloc(32).toString("base64url") }),
      "STALE_DELETE_CONFIRMATION",
    );
    const limited = expectAppError(
      () => remove(optionId, { confirmationToken: String(required.details?.token) }),
      "RATE_LIMITED",
    );

    expect(limited.retryAfterSeconds).toBe(60);
    expect(database.connection.db.select().from(rateLimitWindows).where(eq(rateLimitWindows.key, rateKey)).get()?.count)
      .toBe(PUBLIC_WRITE_RATE_LIMIT);
    expect(database.connection.db.select().from(appointmentOptions).all()).toHaveLength(1);
    expect(storedRevision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back quota, cascading responses, deletion, and revision when the atomic delete fails", () => {
    const optionId = insertOption();
    respond(optionId, creatorParticipantId);
    const token = confirmationToken(optionId);
    const rateKey = RATE_DIGESTER.digestRateKey("public-write", appointmentId, "participant", creatorParticipantId);
    database.connection.db.insert(rateLimitWindows).values({
      key: rateKey,
      count: 3,
      windowStartedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();
    database.connection.sqlite.exec(`
      CREATE TRIGGER fail_option_delete
      BEFORE DELETE ON appointment_options
      BEGIN
        SELECT RAISE(ABORT, 'forced option delete failure');
      END
    `);

    const error = expectAppError(() => remove(optionId, { confirmationToken: token }), "INTERNAL_ERROR");

    expect(error.message).toBe("Could not delete the option.");
    expect(database.connection.db.select().from(rateLimitWindows).where(eq(rateLimitWindows.key, rateKey)).get()?.count)
      .toBe(3);
    expect(database.connection.db.select().from(appointmentOptions).all()).toHaveLength(1);
    expect(database.connection.db.select().from(responses).all()).toHaveLength(1);
    expect(storedRevision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
