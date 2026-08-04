import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from "vitest";

import { user } from "../../../db/auth-schema";
import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
  responses,
} from "../../../db/schema";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
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
import { deleteAppointment, reopenAppointment } from "./management";

const UPDATED_NOW = TEST_NOW + 5_000;
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";

let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerParticipantId: string;
let guestParticipantId: string;
let optionId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let clockNow: MockInstance<() => number>;

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
  insertManager(database, appointmentId);
  ownerParticipantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  guestParticipantId = insertParticipant(database, appointmentId, "Guest");
  optionId = database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId: ownerParticipantId,
    startDate: "2030-01-01",
    canonicalKey: "D:2030-01-01",
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
  database.connection.db.insert(responses).values({
    appointmentId,
    participantId: guestParticipantId,
    optionId,
    value: "YES",
    updatedAt: TEST_NOW,
  }).run();
  clockNow = vi.spyOn(database.context.clock, "now").mockReturnValue(UPDATED_NOW);
});

afterEach(() => database.close());

function appointmentRow() {
  return database.connection.db.select().from(appointments)
    .where(eq(appointments.id, appointmentId)).get();
}

function finalizeFixture(): void {
  database.connection.db.update(appointments).set({
    status: "FINALIZED",
    finalOptionId: optionId,
  }).where(eq(appointments.id, appointmentId)).run();
}

function expectAppError(operation: () => unknown, code: AppError["code"]): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AppError);
  expect(thrown).toMatchObject({ code });
}

describe("reopenAppointment", () => {
  it("reopens for the owner with one clock value and one post-commit revision while preserving options and responses", () => {
    finalizeFixture();
    publish.mockImplementation(() => {
      expect(database.connection.sqlite.inTransaction).toBe(false);
      expect(appointmentRow()).toMatchObject({
        status: "ACTIVE",
        finalOptionId: null,
        revision: 2,
      });
    });

    expect(reopenAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 2,
      updatedAt: UPDATED_NOW,
    });
    expect(database.connection.db.select().from(appointmentOptions).all()).toHaveLength(1);
    expect(database.connection.db.select().from(responses).all()).toEqual([
      expect.objectContaining({
        appointmentId,
        participantId: guestParticipantId,
        optionId,
        value: "YES",
      }),
    ]);
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("lets a bound co-organizer reopen a finalized appointment", () => {
    finalizeFixture();

    expect(reopenAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 2,
    });
  });

  it("is an unpublished no-op for an active appointment without consulting the clock", () => {
    expect(reopenAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
    })).toEqual({ revision: 1 });

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("preserves not-found and forbidden disclosure for absent appointments and unbound users", () => {
    expectAppError(() => reopenAppointment(database.context, {
      publicId: OTHER_PUBLIC_ID,
      userId: OWNER_USER_ID,
    }), "NOT_FOUND");
    expectAppError(() => reopenAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OTHER_USER_ID,
    }), "FORBIDDEN");

    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back a failed reopen and does not publish", () => {
    finalizeFixture();
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_reopen
      BEFORE UPDATE OF status ON appointments
      WHEN OLD.id = '${appointmentId}' AND NEW.status = 'ACTIVE'
      BEGIN
        SELECT RAISE(ABORT, 'forced reopen failure');
      END
    `);

    expect(() => reopenAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
    })).toThrow("forced reopen failure");

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("deleteAppointment", () => {
  it("discloses a real appointment to authenticated nonmanagers, requires owner role, and compares the title exactly", () => {
    expectAppError(() => deleteAppointment(database.context, {
      publicId: OTHER_PUBLIC_ID,
      userId: OWNER_USER_ID,
      title: "Planning",
    }), "NOT_FOUND");
    expectAppError(() => deleteAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OTHER_USER_ID,
      title: "Planning",
    }), "FORBIDDEN");
    expectAppError(() => deleteAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      title: "Planning",
    }), "FORBIDDEN");
    for (const title of ["planning", "Planning ", "Other"]) {
      expectAppError(() => deleteAppointment(database.context, {
        publicId: PUBLIC_ID,
        userId: OWNER_USER_ID,
        title,
      }), "TITLE_CONFIRMATION_MISMATCH");
    }

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("deletes an active appointment with complete cascades while preserving unrelated rows, users, and guest sessions", () => {
    const retainedSessionHash = Buffer.alloc(32, 0x31);
    database.connection.db.insert(guestSessions).values({
      tokenHash: retainedSessionHash,
      expiresAt: TEST_NOW + 60_000,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
    }).run();
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: retainedSessionHash,
      participantId: guestParticipantId,
      createdAt: TEST_NOW,
    }).run();

    const otherAppointmentId = insertAppointment(database, OWNER_USER_ID, OTHER_PUBLIC_ID);
    insertManager(database, otherAppointmentId, {
      userId: OWNER_USER_ID,
      email: "owner@example.com",
      role: "OWNER",
    });
    const otherParticipantId = insertParticipant(database, otherAppointmentId, "Other participant");
    const otherOptionId = database.connection.db.insert(appointmentOptions).values({
      appointmentId: otherAppointmentId,
      creatorParticipantId: otherParticipantId,
      startDate: "2030-02-01",
      canonicalKey: "D:2030-02-01",
      createdAt: TEST_NOW,
    }).returning({ id: appointmentOptions.id }).get().id;
    database.connection.db.insert(responses).values({
      appointmentId: otherAppointmentId,
      participantId: otherParticipantId,
      optionId: otherOptionId,
      value: "NO",
      updatedAt: TEST_NOW,
    }).run();
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: retainedSessionHash,
      participantId: otherParticipantId,
      createdAt: TEST_NOW,
    }).run();

    expect(deleteAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      title: "Planning",
    })).toBeUndefined();

    expect(appointmentRow()).toBeUndefined();
    expect(database.connection.db.select().from(appointmentManagers)
      .where(eq(appointmentManagers.appointmentId, appointmentId)).all()).toHaveLength(0);
    expect(database.connection.db.select().from(participants)
      .where(eq(participants.appointmentId, appointmentId)).all()).toHaveLength(0);
    expect(database.connection.db.select().from(appointmentOptions)
      .where(eq(appointmentOptions.appointmentId, appointmentId)).all()).toHaveLength(0);
    expect(database.connection.db.select().from(responses)
      .where(eq(responses.appointmentId, appointmentId)).all()).toHaveLength(0);
    expect(database.connection.db.select().from(appointments)
      .where(eq(appointments.id, otherAppointmentId)).get()).toBeDefined();
    expect(database.connection.db.select().from(appointmentManagers)
      .where(eq(appointmentManagers.appointmentId, otherAppointmentId)).all()).toHaveLength(1);
    expect(database.connection.db.select().from(participants)
      .where(eq(participants.appointmentId, otherAppointmentId)).all()).toHaveLength(1);
    expect(database.connection.db.select().from(appointmentOptions)
      .where(eq(appointmentOptions.appointmentId, otherAppointmentId)).all()).toHaveLength(1);
    expect(database.connection.db.select().from(responses)
      .where(eq(responses.appointmentId, otherAppointmentId)).all()).toHaveLength(1);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([
      expect.objectContaining({ participantId: otherParticipantId }),
    ]);
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(1);
    expect(database.connection.db.select().from(user).all()).toHaveLength(3);
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("clears finalized state before deletion and publishes only the tombstone revision after commit", () => {
    finalizeFixture();
    database.connection.db.update(appointments).set({ revision: 7 })
      .where(eq(appointments.id, appointmentId)).run();
    database.connection.sqlite.exec(`
      CREATE TRIGGER require_reopen_before_appointment_delete
      BEFORE DELETE ON appointments
      WHEN OLD.status = 'FINALIZED' OR OLD.final_option_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'finalized appointment was not reopened');
      END
    `);
    publish.mockImplementation(() => {
      expect(database.connection.sqlite.inTransaction).toBe(false);
      expect(appointmentRow()).toBeUndefined();
    });

    expect(deleteAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      title: "Planning",
    })).toBeUndefined();

    expect(appointmentRow()).toBeUndefined();
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 8);
  });

  it("rolls back a finalized pre-delete reopen when deletion fails and never publishes", () => {
    finalizeFixture();
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_appointment_delete
      BEFORE DELETE ON appointments
      BEGIN
        SELECT RAISE(ABORT, 'forced deletion failure');
      END
    `);

    expect(() => deleteAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      title: "Planning",
    })).toThrow("forced deletion failure");

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
