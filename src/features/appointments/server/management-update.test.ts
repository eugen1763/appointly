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

import { appointmentOptions, appointments } from "../../../db/schema";
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
import { updateAppointment } from "./management";

const UPDATED_NOW = TEST_NOW + 5_000;

let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerParticipantId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let clockNow: MockInstance<() => number>;

beforeEach(() => {
  publish = vi.fn();
  database = createEnrollmentTestDatabase({ publish });
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
  });
  insertManager(database, appointmentId);
  ownerParticipantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  clockNow = vi.spyOn(database.context.clock, "now").mockReturnValue(UPDATED_NOW);
});

afterEach(() => database.close());

function appointmentRow() {
  const row = database.connection.db.select().from(appointments)
    .where(eq(appointments.id, appointmentId)).get();
  if (!row) throw new Error("Fixture appointment missing");
  return row;
}

function addDateOption(date: string): void {
  database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId: ownerParticipantId,
    startDate: date,
    endDate: null,
    startAt: null,
    endAt: null,
    canonicalKey: `D:${date}`,
    createdAt: TEST_NOW,
  }).run();
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

describe("updateAppointment", () => {
  it("lets the owner update every mutable detail with one revision and clock value", () => {
    const result = updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: {
        title: "Updated planning",
        description: "Bring the agenda",
        optionLimit: 12,
      },
    });

    expect(result).toEqual({ revision: 2 });
    expect(appointmentRow()).toMatchObject({
      title: "Updated planning",
      description: "Bring the agenda",
      type: "DATE",
      optionLimit: 12,
      revision: 2,
      updatedAt: UPDATED_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("lets a bound co-organizer update details", () => {
    expect(updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      changes: { description: "Co-organizer update" },
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      description: "Co-organizer update",
      revision: 2,
    });
  });

  it("rejects an unbound or unknown user without changing state", () => {
    database.connection.db.update(appointments).set({ title: "Before" })
      .where(eq(appointments.id, appointmentId)).run();
    database.connection.sqlite.prepare(
      "UPDATE appointment_managers SET user_id = NULL WHERE appointment_id = ? AND role = 'COORGANIZER'",
    ).run(appointmentId);

    for (const userId of [MANAGER_USER_ID, "unknown-user"]) {
      expectAppError(() => updateAppointment(database.context, {
        publicId: PUBLIC_ID,
        userId,
        changes: { title: "Forbidden" },
      }), "FORBIDDEN");
    }

    expect(appointmentRow()).toMatchObject({ title: "Before", revision: 1, updatedAt: TEST_NOW });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects finalized appointments without changing state", () => {
    finalizeAppointment(database, appointmentId, ownerParticipantId);

    expectAppError(() => updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { title: "Too late" },
    }), "APPOINTMENT_FINALIZED");

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1, updatedAt: TEST_NOW });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["blank title", { title: "   " }],
    ["long title", { title: "x".repeat(121) }],
    ["long description", { description: "x".repeat(2_001) }],
    ["zero limit", { optionLimit: 0 }],
    ["fractional limit", { optionLimit: 1.5 }],
    ["high limit", { optionLimit: 101 }],
  ])("rejects an invalid %s before any write", (_label, changes) => {
    expectAppError(() => updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes,
    }), "VALIDATION_FAILED");

    expect(appointmentRow()).toMatchObject({
      title: "Planning",
      description: null,
      optionLimit: 10,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a limit below the current option count but accepts an equal limit", () => {
    addDateOption("2030-01-01");
    addDateOption("2030-01-02");

    expectAppError(() => updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { optionLimit: 1 },
    }), "LIMIT_BELOW_CURRENT_COUNT");
    expect(appointmentRow()).toMatchObject({ optionLimit: 10, revision: 1, updatedAt: TEST_NOW });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    expect(updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { optionLimit: 2 },
    })).toEqual({ revision: 2 });
    expect(appointmentRow()).toMatchObject({ optionLimit: 2, revision: 2, updatedAt: UPDATED_NOW });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("returns the current revision for a no-op without a timestamp write or event", () => {
    expect(updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { title: "Planning", description: null, optionLimit: 10 },
    })).toEqual({ revision: 1 });

    expect(appointmentRow()).toMatchObject({ revision: 1, updatedAt: TEST_NOW });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back every field when the single update statement fails", () => {
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_detail_update
      BEFORE UPDATE OF option_limit ON appointments
      WHEN NEW.option_limit = 9
      BEGIN
        SELECT RAISE(ABORT, 'forced update failure');
      END
    `);

    expect(() => updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { title: "Must roll back", optionLimit: 9 },
    })).toThrow("forced update failure");

    expect(appointmentRow()).toMatchObject({
      title: "Planning",
      optionLimit: 10,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes only after commit and isolates publisher failure", () => {
    publish.mockImplementation(() => {
      expect(database.connection.sqlite.inTransaction).toBe(false);
      expect(appointmentRow().revision).toBe(2);
      throw new Error("subscriber failed");
    });

    expect(updateAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      changes: { title: "Committed" },
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({ title: "Committed", revision: 2, updatedAt: UPDATED_NOW });
    expect(publish).toHaveBeenCalledOnce();
  });
});
