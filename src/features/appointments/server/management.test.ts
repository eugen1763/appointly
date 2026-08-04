import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appointmentManagers, appointments, participants } from "../../../db/schema";
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
import { InProcessAppointmentEventPublisher } from "./event-publisher";
import {
  createManagerParticipant,
  deriveManagerParticipantName,
  ensureBoundManagerParticipant,
} from "./management";

let database: EnrollmentTestDatabase;
let appointmentId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId);
  insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
});

afterEach(() => database.close());

function participantRows() {
  return database.connection.db.select().from(participants).where(
    eq(participants.appointmentId, appointmentId),
  ).all();
}

function revision(): number {
  const appointment = database.connection.db.select({ revision: appointments.revision })
    .from(appointments).where(eq(appointments.id, appointmentId)).get();
  if (!appointment) throw new Error("Fixture appointment missing");
  return appointment.revision;
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

describe("deriveManagerParticipantName", () => {
  it("uses the normalized nonempty Google name before the email local part", () => {
    expect(deriveManagerParticipantName("  Ａｖｅｒｙ   Smith ", "account@example.com"))
      .toEqual({ displayName: "Avery Smith", normalizedName: "avery smith" });
  });

  it("uses the normalized email local part when the Google name is empty", () => {
    expect(deriveManagerParticipantName(" \t ", " Planner.Team@Example.COM "))
      .toEqual({ displayName: "planner.team", normalizedName: "planner.team" });
  });
});

describe("ensureBoundManagerParticipant", () => {
  it("reuses an existing linked participant before checking finalized state", () => {
    const participantId = insertParticipant(database, appointmentId, "Existing", MANAGER_USER_ID);
    finalizeAppointment(database, appointmentId, participantRows()[0]!.id);

    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Different",
      email: "manager@example.com",
    });

    expect(result).toEqual({
      participantId,
      revision: 1,
      created: false,
      needsParticipantName: false,
      participantEnrollmentError: null,
    });
    expect(participantRows()).toHaveLength(2);
  });

  it("creates a linked participant and increments revision exactly once", () => {
    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "  Manager   Name ",
      email: "manager@example.com",
    });

    expect(result).toMatchObject({
      revision: 2,
      created: true,
      needsParticipantName: false,
      participantEnrollmentError: null,
    });
    expect(participantRows()).toContainEqual(expect.objectContaining({
      id: result.participantId,
      userId: MANAGER_USER_ID,
      displayName: "Manager Name",
      normalizedName: "manager name",
    }));
    expect(revision()).toBe(2);
  });

  it("returns a name prompt without changing state when the derived name is taken", () => {
    insertParticipant(database, appointmentId, "Manager Name");

    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "manager name",
      email: "manager@example.com",
    });

    expect(result).toEqual({
      participantId: null,
      revision: 1,
      created: false,
      needsParticipantName: true,
      participantEnrollmentError: null,
    });
    expect(revision()).toBe(1);
  });

  it("returns the participant cap state without changing revision", () => {
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

    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    });

    expect(result).toEqual({
      participantId: null,
      revision: 1,
      created: false,
      needsParticipantName: false,
      participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED",
    });
    expect(revision()).toBe(1);
  });

  it("does not enroll a new participant after finalization", () => {
    finalizeAppointment(database, appointmentId, participantRows()[0]!.id);

    const result = ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    });

    expect(result).toEqual({
      participantId: null,
      revision: 1,
      created: false,
      needsParticipantName: false,
      participantEnrollmentError: null,
    });
    expect(participantRows()).toHaveLength(1);
  });

  it("refuses an authenticated user who is not a bound manager", () => {
    insertUser(database, "00000000-0000-4000-8000-000000000003", "other@example.com", "Other");

    expectAppError(() => ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: "00000000-0000-4000-8000-000000000003",
      googleName: "Other",
      email: "other@example.com",
    }), "FORBIDDEN");
  });

  it("publishes synchronously only after the creation transaction commits", () => {
    database.close();
    const observations: Array<{ revision: number; participantCount: number }> = [];
    let currentDatabase: EnrollmentTestDatabase;
    const publish = vi.fn((_appointmentId: string, eventRevision: number) => {
      const participantCount = currentDatabase.connection.sqlite
        .prepare("SELECT count(*) FROM participants WHERE appointment_id = ?")
        .pluck().get(appointmentId) as number;
      observations.push({ revision: eventRevision, participantCount });
    });
    currentDatabase = createEnrollmentTestDatabase({ publish });
    database = currentDatabase;
    insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
    insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
    appointmentId = insertAppointment(database);
    insertManager(database, appointmentId);
    insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);

    ensureBoundManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      googleName: "Manager",
      email: "manager@example.com",
    });

    expect(observations).toEqual([{ revision: 2, participantCount: 2 }]);
  });
});

describe("createManagerParticipant", () => {
  it("returns an existing linked participant before finalized and cap checks", () => {
    const participantId = insertParticipant(database, appointmentId, "Existing", MANAGER_USER_ID);
    finalizeAppointment(database, appointmentId, participantRows()[0]!.id);

    expect(createManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      displayName: "Ignored",
    })).toEqual({ participantId, revision: 1, created: false });
  });

  it("creates once, increments once, and publishes once", () => {
    const publish = vi.spyOn(database.context.eventPublisher, "publish");

    const result = createManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      displayName: "  Manual   Manager ",
    });

    expect(result).toMatchObject({ revision: 2, created: true });
    expect(revision()).toBe(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("binds a pending matching manager and creates the participant in one revision", () => {
    database.connection.db.update(appointmentManagers)
      .set({ userId: null })
      .where(eq(appointmentManagers.appointmentId, appointmentId))
      .run();
    const publish = vi.spyOn(database.context.eventPublisher, "publish");

    const result = createManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      email: " MANAGER@EXAMPLE.COM ",
      displayName: "Manual Manager",
    });

    expect(result).toMatchObject({ revision: 2, created: true });
    expect(revision()).toBe(2);
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers).get()?.userId).toBe(MANAGER_USER_ID);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("returns the committed result when an event subscriber throws", () => {
    database.close();
    const publisher = new InProcessAppointmentEventPublisher();
    database = createEnrollmentTestDatabase(publisher);
    insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
    insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
    appointmentId = insertAppointment(database);
    insertManager(database, appointmentId);
    insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
    publisher.subscribe(appointmentId, () => {
      throw new Error("subscriber failed");
    });

    expect(() => createManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      displayName: "Manual Manager",
    })).not.toThrow();
    expect(revision()).toBe(2);
    expect(participantRows()).toHaveLength(2);
  });

  it.each([
    ["NAME_TAKEN", () => insertParticipant(database, appointmentId, "Manual Manager")],
    ["PARTICIPANT_LIMIT_REACHED", () => database.connection.db.insert(participants).values(
      Array.from({ length: 199 }, (_, index) => ({
        appointmentId,
        userId: null,
        displayName: `Guest ${index}`,
        normalizedName: `guest ${index}`,
        editTokenHash: null,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      })),
    ).run()],
    ["APPOINTMENT_FINALIZED", () => finalizeAppointment(database, appointmentId, participantRows()[0]!.id)],
  ] as const)("throws %s without changing revision", (code, arrange) => {
    arrange();
    const publish = vi.spyOn(database.context.eventPublisher, "publish");
    expectAppError(() => createManagerParticipant(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
      displayName: "Manual Manager",
    }), code);
    expect(revision()).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["NAME_TAKEN", () => insertParticipant(database, appointmentId, "Manual Manager")],
    ["PARTICIPANT_LIMIT_REACHED", () => database.connection.db.insert(participants).values(
      Array.from({ length: 199 }, (_, index) => ({
        appointmentId,
        userId: null,
        displayName: `Pending Guest ${index}`,
        normalizedName: `pending guest ${index}`,
        editTokenHash: null,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      })),
    ).run()],
    ["APPOINTMENT_FINALIZED", () => finalizeAppointment(database, appointmentId, participantRows()[0]!.id)],
  ] as const)(
    "commits pending-manager binding before returning %s",
    (code, arrange) => {
      database.connection.db.update(appointmentManagers)
        .set({ userId: null })
        .where(eq(appointmentManagers.appointmentId, appointmentId))
        .run();
      arrange();
      const publish = vi.spyOn(database.context.eventPublisher, "publish");

      expectAppError(() => createManagerParticipant(database.context, {
        publicId: PUBLIC_ID,
        userId: MANAGER_USER_ID,
        email: "manager@example.com",
        displayName: "Manual Manager",
      }), code);

      expect(database.connection.db.select({ userId: appointmentManagers.userId })
        .from(appointmentManagers).get()?.userId).toBe(MANAGER_USER_ID);
      expect(revision()).toBe(2);
      expect(publish).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledWith(appointmentId, 2);
    },
  );
});
