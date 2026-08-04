import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appointmentManagers, appointments } from "../../../db/schema";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertManager,
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
      },
      {
        publicId: PUBLIC_ID,
        title: "Planning",
        type: "DATE",
        status: "ACTIVE",
        updatedAt: TEST_NOW,
        role: "OWNER",
      },
    ]);
    expect(Object.keys(result.appointments[0] ?? {}).sort()).toEqual([
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
