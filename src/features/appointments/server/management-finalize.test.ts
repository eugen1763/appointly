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
import { finalizeAppointment } from "./management";

const UPDATED_NOW = TEST_NOW + 5_000;
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";

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

function addDateOption(
  targetAppointmentId = appointmentId,
  creatorParticipantId = ownerParticipantId,
  date = "2030-01-01",
): string {
  return database.connection.db.insert(appointmentOptions).values({
    appointmentId: targetAppointmentId,
    creatorParticipantId,
    startDate: date,
    canonicalKey: `D:${date}`,
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
}

function appointmentRow() {
  const row = database.connection.db.select().from(appointments)
    .where(eq(appointments.id, appointmentId)).get();
  if (!row) throw new Error("Fixture appointment missing");
  return row;
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

describe("finalizeAppointment", () => {
  it("lets the bound owner finalize an active appointment with one revision and clock value", () => {
    const optionId = addDateOption();

    expect(finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      optionId,
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 2,
      updatedAt: UPDATED_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("lets a bound co-organizer finalize", () => {
    const optionId = addDateOption();

    expect(finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      optionId,
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 2,
    });
  });

  it("preserves not-found and forbidden disclosure for absent or unbound managers", () => {
    const optionId = addDateOption();

    expectAppError(() => finalizeAppointment(database.context, {
      publicId: OTHER_PUBLIC_ID,
      userId: OWNER_USER_ID,
      optionId,
    }), "NOT_FOUND");
    expectAppError(() => finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: "unbound-user",
      optionId,
    }), "FORBIDDEN");

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a missing or cross-appointment option without changing state", () => {
    const otherAppointmentId = insertAppointment(database, OWNER_USER_ID, OTHER_PUBLIC_ID);
    const otherParticipantId = insertParticipant(database, otherAppointmentId, "Other Owner", OWNER_USER_ID);
    const crossAppointmentOptionId = addDateOption(
      otherAppointmentId,
      otherParticipantId,
      "2030-02-01",
    );

    for (const optionId of [
      "00000000-0000-4000-8000-000000000099",
      crossAppointmentOptionId,
    ]) {
      expectAppError(() => finalizeAppointment(database.context, {
        publicId: PUBLIC_ID,
        userId: OWNER_USER_ID,
        optionId,
      }), "INVALID_FINAL_OPTION");
    }

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns APPOINTMENT_FINALIZED for a serialized second finalizer without another write", () => {
    const firstOptionId = addDateOption();
    const secondOptionId = addDateOption(appointmentId, ownerParticipantId, "2030-01-02");

    expect(finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      optionId: firstOptionId,
    })).toEqual({ revision: 2 });
    expectAppError(() => finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: MANAGER_USER_ID,
      optionId: secondOptionId,
    }), "APPOINTMENT_FINALIZED");

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: firstOptionId,
      revision: 2,
      updatedAt: UPDATED_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("rolls back the final state and does not publish when the update fails", () => {
    const optionId = addDateOption();
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_finalization
      BEFORE UPDATE OF status ON appointments
      WHEN NEW.status = 'FINALIZED'
      BEGIN
        SELECT RAISE(ABORT, 'forced finalization failure');
      END
    `);

    expect(() => finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      optionId,
    })).toThrow("forced finalization failure");

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 1,
      updatedAt: TEST_NOW,
    });
    expect(clockNow).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes only after commit and isolates publisher failure", () => {
    const optionId = addDateOption();
    publish.mockImplementation(() => {
      expect(database.connection.sqlite.inTransaction).toBe(false);
      expect(appointmentRow()).toMatchObject({
        status: "FINALIZED",
        finalOptionId: optionId,
        revision: 2,
      });
      throw new Error("subscriber failed");
    });

    expect(finalizeAppointment(database.context, {
      publicId: PUBLIC_ID,
      userId: OWNER_USER_ID,
      optionId,
    })).toEqual({ revision: 2 });

    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 2,
      updatedAt: UPDATED_NOW,
    });
    expect(publish).toHaveBeenCalledOnce();
  });
});
