import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  appointments,
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
import { resetParticipantLink } from "./guest-access";
import type { ServiceContext } from "./service-context";

const NEW_EDIT_TOKEN = Buffer.alloc(32, 0x71);
const OLD_EDIT_TOKEN = Buffer.alloc(32, 0x72);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x73));
const UPDATED_NOW = TEST_NOW + 5_000;
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";

let database: EnrollmentTestDatabase;
let appointmentId: string;
let participantId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let tokenFactory: Mock<() => Buffer>;
let clockNow: Mock<() => number>;

beforeEach(() => {
  publish = vi.fn();
  database = createEnrollmentTestDatabase({ publish });
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  insertUser(database, OTHER_USER_ID, "other@example.com", "Other");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
  });
  insertManager(database, appointmentId, MANAGER_USER_ID);
  participantId = insertParticipant(database, appointmentId, "Guest");
  database.connection.db.update(participants)
    .set({ editTokenHash: TOKEN_DIGESTER.digestEditToken(OLD_EDIT_TOKEN) })
    .where(eq(participants.id, participantId))
    .run();

  for (const byte of [0x31, 0x32]) {
    const tokenHash = TOKEN_DIGESTER.digestSessionToken(Buffer.alloc(32, byte));
    database.connection.db.insert(guestSessions).values({
      tokenHash,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: tokenHash,
      participantId,
      createdAt: TEST_NOW,
    }).run();
  }

  tokenFactory = vi.fn(() => Buffer.from(NEW_EDIT_TOKEN));
  clockNow = vi.fn(() => UPDATED_NOW);
});

afterEach(() => database.close());

function serviceContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return {
    ...database.context,
    clock: { now: clockNow },
    tokenFactory,
    ...overrides,
  };
}

function reset(
  managerUserId = OWNER_USER_ID,
  context = serviceContext(),
  tokenDigester: GuestTokenDigester = TOKEN_DIGESTER,
) {
  return resetParticipantLink(context, {
    publicId: PUBLIC_ID,
    participantId,
    managerUserId,
  }, tokenDigester);
}

function expectAppError(operation: () => unknown, code: string): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code });
}

function storedState() {
  return {
    participant: database.connection.db.select().from(participants)
      .where(eq(participants.id, participantId)).get(),
    appointment: database.connection.db.select().from(appointments)
      .where(eq(appointments.id, appointmentId)).get(),
    access: database.connection.db.select().from(guestSessionAccess).all(),
    sessions: database.connection.db.select().from(guestSessions).all(),
  };
}

describe("resetParticipantLink", () => {
  it.each([
    ["owner", OWNER_USER_ID],
    ["co-organizer", MANAGER_USER_ID],
  ])("lets a bound %s rotate the digest and revoke every device access", (_role, managerUserId) => {
    const digestEditToken = vi.fn((token: Uint8Array) => TOKEN_DIGESTER.digestEditToken(token));

    const result = reset(managerUserId, serviceContext(), {
      digestEditToken,
      digestSessionToken: TOKEN_DIGESTER.digestSessionToken,
    });

    expect(result).toEqual({
      participantId,
      editUrl: `/a/${PUBLIC_ID}/edit#participant=${participantId}&token=${NEW_EDIT_TOKEN.toString("base64url")}`,
      revision: 2,
    });
    const state = storedState();
    expect(state.participant).toMatchObject({
      editTokenHash: TOKEN_DIGESTER.digestEditToken(NEW_EDIT_TOKEN),
      updatedAt: UPDATED_NOW,
    });
    expect(state.participant?.editTokenHash).not.toEqual(TOKEN_DIGESTER.digestEditToken(OLD_EDIT_TOKEN));
    expect(state.access).toEqual([]);
    expect(state.sessions).toHaveLength(2);
    expect(state.appointment).toMatchObject({ revision: 2, updatedAt: UPDATED_NOW });
    expect(tokenFactory).toHaveBeenCalledOnce();
    expect(digestEditToken).toHaveBeenCalledOnce();
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("checks appointment, manager, status, and participant ownership before providers or writes", () => {
    expectAppError(() => resetParticipantLink(serviceContext(), {
      publicId: "ABCDEFGHIJKLMNOPQRSTUVWX",
      participantId,
      managerUserId: OWNER_USER_ID,
    }, TOKEN_DIGESTER), "NOT_FOUND");
    expectAppError(() => reset(OTHER_USER_ID), "FORBIDDEN");

    const otherAppointmentId = insertAppointment(database, OWNER_USER_ID, OTHER_PUBLIC_ID);
    const otherParticipantId = insertParticipant(database, otherAppointmentId, "Other guest");
    expectAppError(() => resetParticipantLink(serviceContext(), {
      publicId: PUBLIC_ID,
      participantId: otherParticipantId,
      managerUserId: OWNER_USER_ID,
    }, TOKEN_DIGESTER), "NOT_FOUND");

    finalizeAppointment(database, appointmentId, participantId);
    expectAppError(() => reset(), "APPOINTMENT_FINALIZED");

    expect(tokenFactory).not.toHaveBeenCalled();
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(storedState()).toMatchObject({
      participant: { editTokenHash: TOKEN_DIGESTER.digestEditToken(OLD_EDIT_TOKEN) },
      appointment: { revision: 1 },
    });
    expect(storedState().access).toHaveLength(2);
  });

  it.each([
    ["short token", () => serviceContext({ tokenFactory: () => Buffer.alloc(31) }), TOKEN_DIGESTER],
    ["short digest", () => serviceContext(), {
      digestEditToken: () => Buffer.alloc(31),
      digestSessionToken: TOKEN_DIGESTER.digestSessionToken,
    }],
  ] as const)("maps a %s provider failure safely without mutations", (_case, makeContext, digester) => {
    expectAppError(() => reset(OWNER_USER_ID, makeContext(), digester), "INTERNAL_ERROR");
    expect(storedState()).toMatchObject({
      participant: { editTokenHash: TOKEN_DIGESTER.digestEditToken(OLD_EDIT_TOKEN) },
      appointment: { revision: 1 },
    });
    expect(storedState().access).toHaveLength(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back the digest when access deletion fails", () => {
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_access_delete
      BEFORE DELETE ON guest_session_access
      BEGIN
        SELECT RAISE(ABORT, 'forced access delete failure');
      END
    `);

    expectAppError(() => reset(), "INTERNAL_ERROR");

    expect(storedState()).toMatchObject({
      participant: { editTokenHash: TOKEN_DIGESTER.digestEditToken(OLD_EDIT_TOKEN) },
      appointment: { revision: 1, updatedAt: TEST_NOW },
    });
    expect(storedState().access).toHaveLength(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes after commit and keeps the committed result when the publisher throws", () => {
    publish.mockImplementation(() => {
      expect(database.connection.sqlite.inTransaction).toBe(false);
      expect(storedState().appointment?.revision).toBe(2);
      throw new Error("subscriber failed");
    });

    expect(reset()).toMatchObject({ participantId, revision: 2 });
    expect(storedState().access).toEqual([]);
    expect(publish).toHaveBeenCalledOnce();
  });
});
