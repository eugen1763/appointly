import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
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
import {
  bindPendingManagersForDashboard,
  ensureBoundManagerParticipant,
  inviteCoOrganizer,
  listAppointmentManagers,
  removeCoOrganizer,
} from "./management";

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";
let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerManagerId: string;
let ownerParticipantId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "Owner@Example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, " \tManager@Example.com\r\n", "Manager");
  insertUser(database, OTHER_USER_ID, "other@example.com", "Other");
  appointmentId = insertAppointment(database);
  ownerManagerId = insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
    createdAt: TEST_NOW - 10,
  });
  ownerParticipantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
});

afterEach(() => database.close());

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

function currentRevision(id = appointmentId): number {
  const row = database.connection.db.select({ revision: appointments.revision })
    .from(appointments).where(eq(appointments.id, id)).get();
  if (!row) throw new Error("Appointment fixture missing");
  return row.revision;
}

function managerRow(id: string) {
  return database.connection.db.select().from(appointmentManagers)
    .where(eq(appointmentManagers.id, id)).get();
}

describe("inviteCoOrganizer", () => {
  it("normalizes an email and binds an existing Better Auth user", () => {
    const publish = vi.spyOn(database.context.eventPublisher, "publish");

    const result = inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: " \tMANAGER@EXAMPLE.COM\r\n",
    });

    expect(result).toEqual({
      manager: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email: "manager@example.com",
        role: "COORGANIZER",
        status: "BOUND",
        canRemove: true,
      },
      revision: 2,
    });
    expect(managerRow(result.manager.id)?.userId).toBe(MANAGER_USER_ID);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("keeps an unknown email pending", () => {
    const result = inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: "new.person@example.com",
    });

    expect(result.manager).toMatchObject({
      email: "new.person@example.com",
      status: "PENDING",
      role: "COORGANIZER",
      canRemove: true,
    });
    expect(managerRow(result.manager.id)?.userId).toBeNull();
  });

  it("rejects a duplicate invite and the owner email as existing managers", () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "pending@example.com",
    });

    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: " PENDING@example.COM ",
    }), "MANAGER_ALREADY_EXISTS");
    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: "OWNER@example.com",
    }), "MANAGER_ALREADY_EXISTS");
    expect(currentRevision()).toBe(1);
  });

  it("checks duplicates before the twenty co-organizer cap", () => {
    for (let index = 0; index < 20; index += 1) {
      insertManager(database, appointmentId, {
        userId: null,
        email: `pending-${index}@example.com`,
        createdAt: TEST_NOW + index,
      });
    }

    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: "PENDING-0@EXAMPLE.COM",
    }), "MANAGER_ALREADY_EXISTS");
    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: "overflow@example.com",
    }), "COORGANIZER_LIMIT_REACHED");
  });

  it("rejects finalized appointments and nonowners without changing state", () => {
    finalizeAppointment(database, appointmentId, ownerParticipantId);

    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      email: "new@example.com",
    }), "APPOINTMENT_FINALIZED");
    expectAppError(() => inviteCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: MANAGER_USER_ID,
      email: "new@example.com",
    }), "FORBIDDEN");
    expect(currentRevision()).toBe(1);
  });
});

describe("listAppointmentManagers", () => {
  it("is owner-only and returns private rows ordered by createdAt then id", () => {
    const laterId = insertManager(database, appointmentId, {
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      createdAt: TEST_NOW + 2,
    });
    const tiedFirst = insertManager(database, appointmentId, {
      userId: null,
      email: "a@example.com",
      createdAt: TEST_NOW + 1,
    });
    const tiedSecond = insertManager(database, appointmentId, {
      userId: null,
      email: "b@example.com",
      createdAt: TEST_NOW + 1,
    });
    const tiedIds = [tiedFirst, tiedSecond].sort();

    expect(listAppointmentManagers(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
    })).toEqual({ managers: [
      { id: ownerManagerId, email: "owner@example.com", role: "OWNER", status: "BOUND", canRemove: false },
      { id: tiedIds[0], email: tiedIds[0] === tiedFirst ? "a@example.com" : "b@example.com", role: "COORGANIZER", status: "PENDING", canRemove: true },
      { id: tiedIds[1], email: tiedIds[1] === tiedSecond ? "b@example.com" : "a@example.com", role: "COORGANIZER", status: "PENDING", canRemove: true },
      { id: laterId, email: "manager@example.com", role: "COORGANIZER", status: "BOUND", canRemove: true },
    ] });

    expectAppError(() => listAppointmentManagers(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: MANAGER_USER_ID,
    }), "FORBIDDEN");
  });
});

describe("removeCoOrganizer", () => {
  it("protects the owner and rejects unknown, finalized, and nonowner requests", () => {
    expectAppError(() => removeCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      managerId: ownerManagerId,
    }), "FORBIDDEN");
    expectAppError(() => removeCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      managerId: "00000000-0000-4000-8000-000000000099",
    }), "NOT_FOUND");

    const managerId = insertManager(database, appointmentId);
    expectAppError(() => removeCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: MANAGER_USER_ID,
      managerId,
    }), "FORBIDDEN");
    finalizeAppointment(database, appointmentId, ownerParticipantId);
    expectAppError(() => removeCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      managerId,
    }), "APPOINTMENT_FINALIZED");
    expect(managerRow(managerId)).toBeDefined();
  });

  it("removes only manager access and preserves participant, response, and option ownership", () => {
    const publish = vi.spyOn(database.context.eventPublisher, "publish");
    const managerId = insertManager(database, appointmentId);
    const participantId = insertParticipant(database, appointmentId, "Manager", MANAGER_USER_ID);
    const option = database.connection.db.insert(appointmentOptions).values({
      appointmentId,
      creatorParticipantId: participantId,
      startDate: "2030-02-01",
      endDate: null,
      startAt: null,
      endAt: null,
      canonicalKey: "D:2030-02-01",
      createdAt: TEST_NOW,
    }).returning({ id: appointmentOptions.id }).get();
    database.connection.db.insert(responses).values({
      appointmentId,
      participantId,
      optionId: option.id,
      value: "YES",
      updatedAt: TEST_NOW,
    }).run();

    expect(removeCoOrganizer(database.context, {
      publicId: PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      managerId,
    })).toEqual({ revision: 2 });

    expect(managerRow(managerId)).toBeUndefined();
    expect(database.connection.db.select().from(participants)
      .where(eq(participants.id, participantId)).get()).toBeDefined();
    expect(database.connection.db.select().from(appointmentOptions)
      .where(eq(appointmentOptions.id, option.id)).get()).toBeDefined();
    expect(database.connection.db.select().from(responses).where(and(
      eq(responses.appointmentId, appointmentId),
      eq(responses.participantId, participantId),
      eq(responses.optionId, option.id),
    )).get()?.value).toBe("YES");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });
});

describe("pending manager binding on appointment access", () => {
  it("binds and creates a participant in one revision and one post-commit publish", () => {
    const managerId = insertManager(database, appointmentId, { userId: null });
    const observations: Array<{ revision: number; bound: boolean; participant: boolean }> = [];
    database.context.eventPublisher.publish = (_id, revision) => {
      observations.push({
        revision,
        bound: managerRow(managerId)?.userId === MANAGER_USER_ID,
        participant: database.connection.db.select({ id: participants.id }).from(participants)
          .where(and(eq(participants.appointmentId, appointmentId), eq(participants.userId, MANAGER_USER_ID))).get() !== undefined,
      });
    };

    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: " MANAGER@EXAMPLE.COM ",
    });

    expect(result).toMatchObject({ revision: 2, created: true, needsParticipantName: false });
    expect(observations).toEqual([{ revision: 2, bound: true, participant: true }]);
    expect(currentRevision()).toBe(2);
  });

  it("binds and reuses a linked participant with one revision", () => {
    const managerId = insertManager(database, appointmentId, { userId: null });
    const participantId = insertParticipant(database, appointmentId, "Existing", MANAGER_USER_ID);

    expect(ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    })).toEqual({
      participantId,
      revision: 2,
      created: false,
      needsParticipantName: false,
      participantEnrollmentError: null,
    });
    expect(managerRow(managerId)?.userId).toBe(MANAGER_USER_ID);
  });

  it("commits binding with one revision when enrollment needs a name or hits the cap", () => {
    const pendingConflict = insertManager(database, appointmentId, { userId: null });
    insertParticipant(database, appointmentId, "Manager");

    expect(ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "manager",
      email: "manager@example.com",
    })).toEqual({
      participantId: null,
      revision: 2,
      created: false,
      needsParticipantName: true,
      participantEnrollmentError: null,
    });
    expect(managerRow(pendingConflict)?.userId).toBe(MANAGER_USER_ID);

    const secondAppointmentId = insertAppointment(database, OWNER_USER_ID, "bcdefghijklmnopqrstuvwxy");
    insertManager(database, secondAppointmentId, {
      userId: OWNER_USER_ID,
      email: "owner@example.com",
      role: "OWNER",
    });
    insertManager(database, secondAppointmentId, { userId: null });
    insertParticipant(database, secondAppointmentId, "Owner", OWNER_USER_ID);
    database.connection.db.insert(participants).values(Array.from({ length: 199 }, (_, index) => ({
      appointmentId: secondAppointmentId,
      userId: null,
      displayName: `Guest ${index}`,
      normalizedName: `guest ${index}`,
      editTokenHash: null,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }))).run();

    expect(ensureBoundManagerParticipant(database.context, {
      publicId: "bcdefghijklmnopqrstuvwxy",
      userId: MANAGER_USER_ID,
      googleName: "Manager Two",
      email: "manager@example.com",
    })).toEqual({
      participantId: null,
      revision: 2,
      created: false,
      needsParticipantName: false,
      participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED",
    });
    expect(currentRevision(secondAppointmentId)).toBe(2);
  });

  it("does not bind or increment again on repeated access", () => {
    insertManager(database, appointmentId, { userId: null });
    const first = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    });
    const second = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    });

    expect(first.revision).toBe(2);
    expect(second).toMatchObject({ participantId: first.participantId, revision: 2, created: false });
    expect(currentRevision()).toBe(2);
  });
});

describe("bindPendingManagersForDashboard", () => {
  it("binds every matching row, increments each appointment once, and publishes after commit", () => {
    const secondPublicId = "bcdefghijklmnopqrstuvwxy";
    const secondAppointmentId = insertAppointment(database, OWNER_USER_ID, secondPublicId);
    insertManager(database, secondAppointmentId, {
      userId: OWNER_USER_ID,
      email: "owner@example.com",
      role: "OWNER",
    });
    const firstManagerId = insertManager(database, appointmentId, { userId: null });
    const secondManagerId = insertManager(database, secondAppointmentId, { userId: null });
    insertManager(database, secondAppointmentId, { userId: null, email: "unmatched@example.com" });
    const observations: Array<{ appointmentId: string; revision: number; allBound: boolean }> = [];
    database.context.eventPublisher.publish = (publishedAppointmentId, revision) => {
      observations.push({
        appointmentId: publishedAppointmentId,
        revision,
        allBound: [firstManagerId, secondManagerId].every((id) => managerRow(id)?.userId === MANAGER_USER_ID),
      });
    };

    const result = bindPendingManagersForDashboard(database.context, {
      userId: MANAGER_USER_ID,
      email: " MANAGER@EXAMPLE.COM ",
    });

    expect(result.boundAppointments).toEqual([
      { appointmentId, publicId: PUBLIC_ID, revision: 2 },
      { appointmentId: secondAppointmentId, publicId: secondPublicId, revision: 2 },
    ]);
    expect(observations).toEqual([
      { appointmentId, revision: 2, allBound: true },
      { appointmentId: secondAppointmentId, revision: 2, allBound: true },
    ]);
    expect(currentRevision()).toBe(2);
    expect(currentRevision(secondAppointmentId)).toBe(2);
  });
});
