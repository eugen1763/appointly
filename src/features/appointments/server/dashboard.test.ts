import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appointmentManagers, appointments } from "../../../db/schema";
import {
  createEnrollmentTestDatabase,
  finalizeAppointment,
  insertAppointment,
  insertManager,
  insertOption,
  insertParticipant,
  insertResponse,
  insertUser,
  MANAGER_USER_ID,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import {
  bindPendingManagersForDashboard,
  listDashboardAppointments,
} from "./management";

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";
const SECOND_PUBLIC_ID = "bcdefghijklmnopqrstuvwxy";
const THIRD_PUBLIC_ID = "cdefghijklmnopqrstuvwxyz";
const FOURTH_PUBLIC_ID = "defghijklmnopqrstuvwxyza";

let database: EnrollmentTestDatabase;
let appointmentId: string;

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
});

afterEach(() => database.close());

describe("listDashboardAppointments", () => {
  it("lists a pending invitation after the dashboard binding command runs", () => {
    const pendingManagerId = insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
    });

    expect(listDashboardAppointments(database.context, {
      userId: MANAGER_USER_ID,
    }).appointments).toEqual([]);

    bindPendingManagersForDashboard(database.context, {
      userId: MANAGER_USER_ID,
      email: " MANAGER@EXAMPLE.COM ",
    });

    expect(listDashboardAppointments(database.context, {
      userId: MANAGER_USER_ID,
    }).appointments).toEqual([{
      publicId: PUBLIC_ID,
      title: "Planning",
      type: "DATE",
      status: "ACTIVE",
      updatedAt: TEST_NOW,
      role: "COORGANIZER",
      optionCount: 0,
      participantCount: 0,
      leadingOption: null,
    }]);
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers)
      .where(eq(appointmentManagers.id, pendingManagerId))
      .get()?.userId).toBe(MANAGER_USER_ID);
  });

  it("returns display-safe owner and co-organizer records with their roles", () => {
    const managedAppointmentId = insertAppointment(
      database,
      OTHER_USER_ID,
      SECOND_PUBLIC_ID,
    );
    insertManager(database, managedAppointmentId, {
      userId: OTHER_USER_ID,
      email: "other@example.com",
      role: "OWNER",
    });
    insertManager(database, managedAppointmentId, {
      userId: OWNER_USER_ID,
      email: "owner@example.com",
    });
    database.connection.db.update(appointments).set({
      title: "Release review",
      type: "DATE_TIME_RANGE",
      status: "ACTIVE",
      updatedAt: TEST_NOW + 1,
    }).where(eq(appointments.id, managedAppointmentId)).run();

    const result = listDashboardAppointments(database.context, {
      userId: OWNER_USER_ID,
    });

    expect(result.appointments).toEqual([
      {
        publicId: SECOND_PUBLIC_ID,
        title: "Release review",
        type: "DATE_TIME_RANGE",
        status: "ACTIVE",
        updatedAt: TEST_NOW + 1,
        role: "COORGANIZER",
        optionCount: 0,
        participantCount: 0,
        leadingOption: null,
      },
      {
        publicId: PUBLIC_ID,
        title: "Planning",
        type: "DATE",
        status: "ACTIVE",
        updatedAt: TEST_NOW,
        role: "OWNER",
        optionCount: 0,
        participantCount: 0,
        leadingOption: null,
      },
    ]);
    expect(Object.keys(result.appointments[0] ?? {}).sort()).toEqual([
      "leadingOption",
      "optionCount",
      "participantCount",
      "publicId",
      "role",
      "status",
      "title",
      "type",
      "updatedAt",
    ]);
  });

  it("returns an owned appointment once even when it has several managers", () => {
    insertManager(database, appointmentId, {
      userId: MANAGER_USER_ID,
      email: "manager@example.com",
    });
    insertManager(database, appointmentId, {
      userId: OTHER_USER_ID,
      email: "other@example.com",
    });

    const result = listDashboardAppointments(database.context, {
      userId: OWNER_USER_ID,
    });

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]?.publicId).toBe(PUBLIC_ID);
    expect(result.appointments[0]?.role).toBe("OWNER");
  });

  it("excludes unrelated and still-pending appointments", () => {
    const privateAppointmentId = insertAppointment(
      database,
      OTHER_USER_ID,
      SECOND_PUBLIC_ID,
    );
    insertManager(database, privateAppointmentId, {
      userId: OTHER_USER_ID,
      email: "other@example.com",
      role: "OWNER",
    });
    insertManager(database, privateAppointmentId, {
      userId: null,
      email: "manager@example.com",
    });

    expect(listDashboardAppointments(database.context, {
      userId: MANAGER_USER_ID,
    }).appointments).toEqual([]);
  });

  it("sorts newest updates first and breaks ties by public ID", () => {
    const secondId = insertAppointment(database, OTHER_USER_ID, SECOND_PUBLIC_ID);
    const thirdId = insertAppointment(database, OTHER_USER_ID, THIRD_PUBLIC_ID);
    const fourthId = insertAppointment(database, OTHER_USER_ID, FOURTH_PUBLIC_ID);
    for (const [id, email] of [
      [secondId, "owner-2@example.com"],
      [thirdId, "owner-3@example.com"],
      [fourthId, "owner-4@example.com"],
    ] as const) {
      insertManager(database, id, {
        userId: OTHER_USER_ID,
        email,
        role: "OWNER",
      });
      insertManager(database, id, {
        userId: MANAGER_USER_ID,
        email: "manager@example.com",
      });
    }
    database.connection.db.update(appointments).set({ updatedAt: TEST_NOW + 10 })
      .where(eq(appointments.id, secondId)).run();
    database.connection.db.update(appointments).set({ updatedAt: TEST_NOW + 20 })
      .where(eq(appointments.id, thirdId)).run();
    database.connection.db.update(appointments).set({ updatedAt: TEST_NOW + 20 })
      .where(eq(appointments.id, fourthId)).run();

    const result = listDashboardAppointments(database.context, {
      userId: MANAGER_USER_ID,
    });

    expect(result.appointments.map(({ publicId }) => publicId)).toEqual([
      THIRD_PUBLIC_ID,
      FOURTH_PUBLIC_ID,
      SECOND_PUBLIC_ID,
    ]);
  });
});

describe("listDashboardAppointments tallies", () => {
  function ownedAppointment(userId: string) {
    return listDashboardAppointments(database.context, { userId }).appointments[0];
  }

  it("reports the leading option with its yes and no counts", () => {
    const ana = insertParticipant(database, appointmentId, "Ana");
    const bo = insertParticipant(database, appointmentId, "Bo");
    const cy = insertParticipant(database, appointmentId, "Cy");
    const first = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-01",
    });
    const second = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-02",
    });
    insertResponse(database, appointmentId, ana, first, "YES");
    insertResponse(database, appointmentId, bo, first, "YES");
    insertResponse(database, appointmentId, cy, first, "NO");
    insertResponse(database, appointmentId, ana, second, "YES");

    const appointment = ownedAppointment(OWNER_USER_ID);

    expect(appointment).toMatchObject({ optionCount: 2, participantCount: 3 });
    // Exact, so the leading payload never quietly grows a key the card ignores.
    expect(appointment?.leadingOption).toEqual({
      option: { id: first, kind: "DATE", startDate: "2030-02-01" },
      yesCount: 2,
      noCount: 1,
      tied: false,
    });
    expect(appointment?.leadingOption?.option.id).not.toBe(second);
  });

  it("reports no leader while every option is still level", () => {
    const ana = insertParticipant(database, appointmentId, "Ana");
    const first = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-01",
    });
    const second = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-02",
    });
    insertResponse(database, appointmentId, ana, first, "YES");
    insertResponse(database, appointmentId, ana, second, "YES");

    expect(ownedAppointment(OWNER_USER_ID)).toMatchObject({
      optionCount: 2,
      participantCount: 1,
      leadingOption: null,
    });
  });

  it("marks joint leaders as tied and names the first in canonical order", () => {
    const ana = insertParticipant(database, appointmentId, "Ana");
    const bo = insertParticipant(database, appointmentId, "Bo");
    const first = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-01",
    });
    const second = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-02",
    });
    const third = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-03",
    });
    for (const optionId of [first, second]) {
      insertResponse(database, appointmentId, ana, optionId, "YES");
      insertResponse(database, appointmentId, bo, optionId, "YES");
    }
    insertResponse(database, appointmentId, ana, third, "YES");

    expect(ownedAppointment(OWNER_USER_ID)).toMatchObject({
      optionCount: 3,
      participantCount: 2,
      leadingOption: {
        option: { id: first, kind: "DATE", startDate: "2030-02-01" },
        yesCount: 2,
        noCount: 0,
        tied: true,
      },
    });
  });

  it("suppresses the leader once the appointment is finalized", () => {
    const ana = insertParticipant(database, appointmentId, "Ana");
    const first = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-01",
    });
    insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-02",
    });
    insertResponse(database, appointmentId, ana, first, "YES");
    finalizeAppointment(database, appointmentId, ana);

    expect(ownedAppointment(OWNER_USER_ID)).toMatchObject({
      status: "FINALIZED",
      optionCount: 3,
      participantCount: 1,
      leadingOption: null,
    });
  });

  it("reports zeroes for an appointment with no options or participants", () => {
    expect(ownedAppointment(OWNER_USER_ID)).toMatchObject({
      optionCount: 0,
      participantCount: 0,
      leadingOption: null,
    });
  });

  it("keeps each appointment's counts to itself", () => {
    const ana = insertParticipant(database, appointmentId, "Ana");
    const own = insertOption(database, appointmentId, ana, {
      kind: "DATE",
      startDate: "2030-02-01",
    });
    insertResponse(database, appointmentId, ana, own, "YES");

    const otherAppointmentId = insertAppointment(
      database,
      OWNER_USER_ID,
      SECOND_PUBLIC_ID,
    );
    const bo = insertParticipant(database, otherAppointmentId, "Bo");
    const cy = insertParticipant(database, otherAppointmentId, "Cy");
    const otherFirst = insertOption(database, otherAppointmentId, bo, {
      kind: "DATE",
      startDate: "2030-03-01",
    });
    const otherSecond = insertOption(database, otherAppointmentId, bo, {
      kind: "DATE",
      startDate: "2030-03-02",
    });
    insertResponse(database, otherAppointmentId, bo, otherFirst, "NO");
    insertResponse(database, otherAppointmentId, cy, otherFirst, "NO");
    insertResponse(database, otherAppointmentId, bo, otherSecond, "YES");
    database.connection.db.update(appointments)
      .set({ updatedAt: TEST_NOW + 5 })
      .where(eq(appointments.id, otherAppointmentId))
      .run();

    const result = listDashboardAppointments(database.context, {
      userId: OWNER_USER_ID,
    });

    expect(result.appointments).toMatchObject([
      {
        publicId: SECOND_PUBLIC_ID,
        optionCount: 2,
        participantCount: 2,
        leadingOption: {
          option: { id: otherSecond, kind: "DATE", startDate: "2030-03-02" },
          yesCount: 1,
          noCount: 0,
          tied: false,
        },
      },
      {
        publicId: PUBLIC_ID,
        optionCount: 1,
        participantCount: 1,
        leadingOption: null,
      },
    ]);
  });
});
