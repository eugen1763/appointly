import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { appointments } from "../../../db/schema";

import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertUser,
  OWNER_USER_ID,
  PUBLIC_ID,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import { findAppointmentEventTarget } from "./event-stream";

let database: EnrollmentTestDatabase;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
});

afterEach(() => database.close());

describe("findAppointmentEventTarget", () => {
  it("maps a public appointment ID to the internal subscription ID and current revision", () => {
    const appointmentId = insertAppointment(database);
    database.connection.db.update(appointments)
      .set({ revision: 7 })
      .where(eq(appointments.id, appointmentId))
      .run();

    expect(findAppointmentEventTarget(database.context, PUBLIC_ID)).toEqual({
      appointmentId,
      revision: 7,
    });
  });

  it("returns the stable not-found error for an unknown appointment", () => {
    let thrown: unknown;

    try {
      findAppointmentEventTarget(database.context, "ABCDEFGHIJKLMNOPQRSTUVWX");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      code: "NOT_FOUND",
      message: "Appointment was not found.",
    });
  });
});
