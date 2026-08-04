import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appointmentManagers,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../db/schema";
import {
  createGuestTokenDigester,
  createRateKeyDigester,
} from "../../../lib/security";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  finalizeAppointment,
  insertAppointment,
  insertManager,
  insertParticipant,
  insertUser,
  MANAGER_USER_ID,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import { joinParticipant } from "./guest-access";
import type { ServiceContext } from "./service-context";

const EDIT_TOKEN = Buffer.alloc(32, 0x11);
const SESSION_TOKEN = Buffer.alloc(32, 0x22);
const EXISTING_SESSION_TOKEN = Buffer.alloc(32, 0x33);
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";
const YEAR_MS = 31_536_000_000;
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x7a));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x7b));

let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerParticipantId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  insertUser(database, OTHER_USER_ID, "other@example.com", "Other");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
  });
  ownerParticipantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
});

afterEach(() => database.close());

function contextWithTokens(
  tokens: readonly Buffer[] = [EDIT_TOKEN, SESSION_TOKEN],
  publish = vi.fn(),
  now = vi.fn(() => TEST_NOW),
): ServiceContext {
  let index = 0;
  return {
    ...database.context,
    clock: { now },
    tokenFactory: () => {
      const token = tokens[index++];
      if (!token) throw new Error("Unexpected token request");
      return Buffer.from(token);
    },
    eventPublisher: { publish },
  };
}

function join(
  overrides: Partial<Parameters<typeof joinParticipant>[1]> = {},
  context = contextWithTokens(),
  tokenDigester = TOKEN_DIGESTER,
) {
  return joinParticipant(context, {
    publicId: PUBLIC_ID,
    displayName: "  Avery\tGuest  ",
    identity: null,
    guestSessionToken: null,
    clientKey: "direct-client",
    ...overrides,
  }, tokenDigester, RATE_DIGESTER);
}

function expectAppError(operation: () => unknown, code: string): AppError {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect((thrown as AppError).code).toBe(code);
  return thrown as AppError;
}

function expectInternalError(operation: () => unknown): AppError {
  const error = expectAppError(operation, "INTERNAL_ERROR");
  expect(error.message).toBe("Could not join the appointment.");
  return error;
}

function storeSession(rawToken: Buffer, expiresAt = TEST_NOW + YEAR_MS): Buffer {
  const tokenHash = TOKEN_DIGESTER.digestSessionToken(rawToken);
  database.connection.db.insert(guestSessions).values({
    tokenHash,
    createdAt: TEST_NOW - 1_000,
    lastSeenAt: TEST_NOW - 1_000,
    expiresAt,
  }).run();
  return tokenHash;
}

describe("joinParticipant", () => {
  it("creates one unlinked guest graph with independent hidden 32-byte token digests", () => {
    const publish = vi.fn();
    const clock = vi.fn(() => TEST_NOW);
    const result = join({}, contextWithTokens([EDIT_TOKEN, SESSION_TOKEN], publish, clock));

    expect(result).toEqual({
      kind: "guest",
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      editUrl: `/a/${PUBLIC_ID}/edit#participant=${result.participantId}&token=${EDIT_TOKEN.toString("base64url")}`,
      revision: 2,
      sessionToken: SESSION_TOKEN.toString("base64url"),
    });
    const participant = database.connection.db.select().from(participants)
      .where(eq(participants.id, result.participantId)).get();
    expect(participant).toMatchObject({
      appointmentId,
      userId: null,
      displayName: "Avery Guest",
      normalizedName: "avery guest",
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    });
    const editDigest = TOKEN_DIGESTER.digestEditToken(EDIT_TOKEN);
    const sessionDigest = TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN);
    expect(participant?.editTokenHash).toEqual(editDigest);
    expect(participant?.editTokenHash).not.toEqual(sessionDigest);
    expect(participant?.editTokenHash).not.toEqual(EDIT_TOKEN);
    expect(sessionDigest).not.toEqual(SESSION_TOKEN);
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([{
      tokenHash: sessionDigest,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + YEAR_MS,
    }]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([{
      sessionTokenHash: sessionDigest,
      participantId: result.participantId,
      createdAt: TEST_NOW,
    }]);
    expect(clock).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });
  it("domain-separates the same raw token for edit and session storage", () => {
    expect(TOKEN_DIGESTER.digestEditToken(EDIT_TOKEN))
      .not.toEqual(TOKEN_DIGESTER.digestSessionToken(EDIT_TOKEN));
  });


  it("keeps an unrelated signed-in visitor unlinked from their Better Auth user", () => {
    const result = join({
      identity: { userId: OTHER_USER_ID, email: "other@example.com" },
    });

    expect(result.kind).toBe("guest");
    expect(database.connection.db.select({ userId: participants.userId }).from(participants)
      .where(eq(participants.id, result.participantId)).get()?.userId).toBeNull();
  });

  it("atomically binds a matching pending manager without guest secrets or access", () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
      role: "COORGANIZER",
    });
    const tokenFactory = vi.fn(() => { throw new Error("No guest token allowed"); });
    const context = { ...database.context, tokenFactory };

    const result = joinParticipant(context, {
      publicId: PUBLIC_ID,
      displayName: "Co Manager",
      identity: { userId: MANAGER_USER_ID, email: " manager@EXAMPLE.com " },
      guestSessionToken: null,
      clientKey: "direct-client",
    }, TOKEN_DIGESTER, RATE_DIGESTER);

    expect(result).toEqual({
      kind: "manager",
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision: 2,
    });
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers)
      .where(and(
        eq(appointmentManagers.appointmentId, appointmentId),
        eq(appointmentManagers.emailNormalized, "manager@example.com"),
      )).get()?.userId).toBe(MANAGER_USER_ID);
    expect(database.connection.db.select().from(participants)
      .where(eq(participants.id, result.participantId)).get()).toMatchObject({
      userId: MANAGER_USER_ID,
      editTokenHash: null,
    });
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([]);
  });

  it("binds a pending manager before checking this browser's existing guest access", () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
      role: "COORGANIZER",
    });
    const sessionHash = storeSession(EXISTING_SESSION_TOKEN);
    const existingGuestId = insertParticipant(database, appointmentId, "Existing guest");
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: sessionHash,
      participantId: existingGuestId,
      createdAt: TEST_NOW,
    }).run();
    const tokenFactory = vi.fn(() => {
      throw new Error("Pending manager binding must not request a guest token");
    });

    const result = joinParticipant({
      ...database.context,
      tokenFactory,
    }, {
      publicId: PUBLIC_ID,
      displayName: "Co Manager",
      identity: { userId: MANAGER_USER_ID, email: "manager@example.com" },
      guestSessionToken: EXISTING_SESSION_TOKEN.toString("base64url"),
      clientKey: "direct-client",
    }, TOKEN_DIGESTER, RATE_DIGESTER);

    expect(result).toEqual({
      kind: "manager",
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision: 2,
    });
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers)
      .where(eq(appointmentManagers.emailNormalized, "manager@example.com")).get()?.userId)
      .toBe(MANAGER_USER_ID);
    expect(database.connection.db.select().from(participants)
      .where(eq(participants.id, result.participantId)).get()).toMatchObject({
      userId: MANAGER_USER_ID,
      editTokenHash: null,
    });
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([{
      sessionTokenHash: sessionHash,
      participantId: existingGuestId,
      createdAt: TEST_NOW,
    }]);
  });

  it("rejects a bound manager by user id without treating email as account identity", () => {
    insertManager(database, appointmentId, {
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      role: "COORGANIZER",
    });

    expectAppError(() => join({
      identity: { userId: MANAGER_USER_ID, email: "unrelated@example.com" },
    }), "FORBIDDEN");

    const result = join({
      identity: { userId: OTHER_USER_ID, email: "manager@example.com" },
      displayName: "Other person",
    });
    expect(result.kind).toBe("guest");
  });

  it("rejects an authenticated visitor who already has a linked participant", () => {
    insertParticipant(database, appointmentId, "Other linked", OTHER_USER_ID);
    expectAppError(() => join({
      identity: { userId: OTHER_USER_ID, email: "other@example.com" },
    }), "FORBIDDEN");
  });

  it("rejects a visitor whose valid guest session already accesses this appointment", () => {
    const sessionHash = storeSession(EXISTING_SESSION_TOKEN);
    const existingParticipant = insertParticipant(database, appointmentId, "Existing guest");
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: sessionHash,
      participantId: existingParticipant,
      createdAt: TEST_NOW,
    }).run();

    expectAppError(() => join({
      guestSessionToken: EXISTING_SESSION_TOKEN.toString("base64url"),
    }), "FORBIDDEN");
  });

  it("reuses a valid guest session for a different appointment without touching its fixed lifetime", () => {
    const sessionHash = storeSession(EXISTING_SESSION_TOKEN);
    const before = database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, sessionHash)).get();
    const result = join(
      { guestSessionToken: EXISTING_SESSION_TOKEN.toString("base64url") },
      contextWithTokens([EDIT_TOKEN]),
    );

    expect(result).toMatchObject({ kind: "guest", sessionToken: null, revision: 2 });
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, sessionHash)).get()).toEqual(before);
    expect(database.connection.db.select().from(guestSessionAccess)
      .where(eq(guestSessionAccess.participantId, result.participantId)).get()?.sessionTokenHash)
      .toEqual(sessionHash);
  });

  it.each([
    ["unknown", Buffer.alloc(32, 0x44), undefined],
    ["expired", EXISTING_SESSION_TOKEN, TEST_NOW],
  ])("creates a replacement session for an %s cookie", (_label, rawToken, expiresAt) => {
    if (expiresAt !== undefined) storeSession(rawToken, expiresAt);
    const result = join({ guestSessionToken: rawToken.toString("base64url") });
    expect(result).toMatchObject({
      kind: "guest",
      sessionToken: SESSION_TOKEN.toString("base64url"),
    });
  });

  it("deletes an expired presented session and cascades its access before replacement", () => {
    const expiredHash = storeSession(EXISTING_SESSION_TOKEN, TEST_NOW);
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: expiredHash,
      participantId: ownerParticipantId,
      createdAt: TEST_NOW - 500,
    }).run();

    const result = join({
      guestSessionToken: EXISTING_SESSION_TOKEN.toString("base64url"),
    });
    const replacementHash = TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN);

    expect(result).toMatchObject({
      kind: "guest",
      sessionToken: SESSION_TOKEN.toString("base64url"),
    });
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, expiredHash)).get()).toBeUndefined();
    expect(database.connection.db.select().from(guestSessionAccess)
      .where(eq(guestSessionAccess.sessionTokenHash, expiredHash)).all()).toEqual([]);
    expect(database.connection.db.select().from(guestSessions)
      .where(eq(guestSessions.tokenHash, replacementHash)).get()).toEqual({
      tokenHash: replacementHash,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + YEAR_MS,
    });
    expect(database.connection.db.select().from(guestSessionAccess)
      .where(eq(guestSessionAccess.participantId, result.participantId)).get()?.sessionTokenHash)
      .toEqual(replacementHash);
  });

  it("rejects normalized duplicate names", () => {
    insertParticipant(database, appointmentId, "Åvery guest");
    expectAppError(() => join({ displayName: "  A\u030Avery\tGUEST " }), "NAME_TAKEN");
  });

  it("rejects a finalized appointment without graph changes", () => {
    finalizeAppointment(database, appointmentId, ownerParticipantId);
    expectAppError(() => join(), "APPOINTMENT_FINALIZED");
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
  });

  it("rejects the 200 participant cap before requesting tokens", () => {
    database.connection.db.insert(participants).values(
      Array.from({ length: 199 }, (_, index) => ({
        appointmentId,
        userId: null,
        displayName: `Guest ${index}`,
        normalizedName: `guest ${index}`,
        editTokenHash: null,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      })),
    ).run();
    const tokenFactory = vi.fn(() => EDIT_TOKEN);

    expectAppError(() => join({}, { ...database.context, tokenFactory }), "PARTICIPANT_LIMIT_REACHED");
    expect(tokenFactory).not.toHaveBeenCalled();
  });

  it("rolls back pending-manager binding after a late participant insert fault", () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
      role: "COORGANIZER",
    });
    database.connection.sqlite.exec(`
      CREATE TEMP TRIGGER fail_pending_participant
      BEFORE INSERT ON participants
      WHEN NEW.user_id = '${MANAGER_USER_ID}'
      BEGIN SELECT RAISE(ABORT, 'forced participant insert failure'); END
    `);
    const publish = vi.fn();

    expectInternalError(() => join({
      identity: { userId: MANAGER_USER_ID, email: "manager@example.com" },
      displayName: "Manager participant",
    }, contextWithTokens([], publish)));

    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers)
      .where(eq(appointmentManagers.emailNormalized, "manager@example.com")).get()?.userId).toBeNull();
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("maps an invalid token factory result to INTERNAL_ERROR without writes or events", () => {
    const publish = vi.fn();
    const error = expectInternalError(() => join(
      {},
      contextWithTokens([Buffer.alloc(31), SESSION_TOKEN], publish),
    ));

    expect(error.message).not.toContain("32");
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toHaveLength(0);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("maps fixed-expiry overflow to a non-leaking INTERNAL_ERROR without persistence", () => {
    const publish = vi.fn();
    const overflowNow = Number.MAX_SAFE_INTEGER - YEAR_MS + 1;
    const error = expectInternalError(() => join(
      {},
      contextWithTokens(
        [EDIT_TOKEN, SESSION_TOKEN],
        publish,
        vi.fn(() => overflowNow),
      ),
    ));

    expect(error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Could not join the appointment.",
    });
    expect(error.message).not.toMatch(/safe|integer|overflow|timestamp/iu);
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([]);
    expect(database.connection.db.select({ revision: appointments.revision })
      .from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects equal edit and session factory outputs before committing writes", () => {
    const publish = vi.fn();
    expectInternalError(() => join(
      {},
      contextWithTokens([EDIT_TOKEN, EDIT_TOKEN], publish),
    ));

    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toHaveLength(0);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("maps throwing token, digest, and clock providers to the same INTERNAL_ERROR", () => {
    const throwingTokenContext = {
      ...database.context,
      tokenFactory(): Buffer {
        throw new Error("token factory secret");
      },
    };
    expectInternalError(() => join({}, throwingTokenContext));

    const throwingDigester = {
      digestEditToken(): Buffer {
        throw new Error("edit digest secret");
      },
      digestSessionToken(): Buffer {
        throw new Error("session digest secret");
      },
    };
    expectInternalError(() => join({}, contextWithTokens(), throwingDigester));

    const throwingClockContext = {
      ...database.context,
      clock: {
        now(): number {
          throw new Error("clock secret");
        },
      },
    };
    expectInternalError(() => join({}, throwingClockContext));
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toHaveLength(0);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
  });

  it("rolls back session and participant rows after a late access insert fault", () => {
    database.connection.sqlite.exec(`
      CREATE TEMP TRIGGER fail_guest_access
      BEFORE INSERT ON guest_session_access
      BEGIN SELECT RAISE(ABORT, 'forced access insert failure'); END
    `);
    const publish = vi.fn();

    expectInternalError(() => join(
      {},
      contextWithTokens([EDIT_TOKEN, SESSION_TOKEN], publish),
    ));

    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toHaveLength(0);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("restores an expired session and its access when replacement later rolls back", () => {
    const expiredHash = storeSession(EXISTING_SESSION_TOKEN, TEST_NOW);
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: expiredHash,
      participantId: ownerParticipantId,
      createdAt: TEST_NOW - 500,
    }).run();
    database.connection.sqlite.exec(`
      CREATE TEMP TRIGGER fail_replacement_access
      BEFORE INSERT ON guest_session_access
      BEGIN SELECT RAISE(ABORT, 'forced replacement access failure'); END
    `);
    const publish = vi.fn();

    expectInternalError(() => join(
      { guestSessionToken: EXISTING_SESSION_TOKEN.toString("base64url") },
      contextWithTokens([EDIT_TOKEN, SESSION_TOKEN], publish),
    ));

    expect(database.connection.db.select().from(guestSessions).all()).toEqual([{
      tokenHash: expiredHash,
      createdAt: TEST_NOW - 1_000,
      lastSeenAt: TEST_NOW - 1_000,
      expiresAt: TEST_NOW,
    }]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([{
      sessionTokenHash: expiredHash,
      participantId: ownerParticipantId,
      createdAt: TEST_NOW - 500,
    }]);
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select({ revision: appointments.revision })
      .from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back the complete guest graph after a final revision update fault", () => {
    database.connection.sqlite.exec(`
      CREATE TEMP TRIGGER fail_join_revision
      BEFORE UPDATE OF revision ON appointments
      WHEN NEW.revision > OLD.revision
      BEGIN SELECT RAISE(ABORT, 'forced revision failure'); END
    `);
    const publish = vi.fn();

    expectInternalError(() => join(
      {},
      contextWithTokens([EDIT_TOKEN, SESSION_TOKEN], publish),
    ));

    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(0);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toHaveLength(0);
    expect(database.connection.db.select({ revision: appointments.revision }).from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("commits before publishing and isolates publisher failure", () => {
    const publish = vi.fn((publishedAppointmentId: string, revision: number) => {
      expect(publishedAppointmentId).toBe(appointmentId);
      expect(revision).toBe(2);
      expect(database.connection.db.select({ revision: appointments.revision })
        .from(appointments).where(eq(appointments.id, appointmentId)).get()?.revision).toBe(2);
      throw new Error("publisher unavailable");
    });

    const result = join({}, contextWithTokens([EDIT_TOKEN, SESSION_TOKEN], publish));

    expect(result.revision).toBe(2);
    expect(publish).toHaveBeenCalledOnce();
  });
});
