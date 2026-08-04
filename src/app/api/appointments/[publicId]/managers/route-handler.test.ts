import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { appointmentManagers, participants } from "../../../../../db/schema";
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
} from "../../../../../features/appointments/server/enrollment-test-support";
import {
  createManagersGetHandler,
  createManagersPostHandler,
  type ManagersSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const ownerSession = { user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" } };
const managerSession = { user: { id: MANAGER_USER_ID, email: "manager@example.com", name: "Manager" } };
let database: EnrollmentTestDatabase;
let appointmentId: string;
let readSession: Mock<ManagersSessionReader>;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
    createdAt: TEST_NOW - 1,
  });
  insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  readSession = vi.fn().mockResolvedValue(ownerSession);
});

afterEach(() => database.close());

function routeContext(params: Record<string, string> = { publicId: PUBLIC_ID }) {
  return { params: Promise.resolve(params) };
}

function get(params: Record<string, string> = { publicId: PUBLIC_ID }) {
  return createManagersGetHandler({ context: database.context, readSession })(
    new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/managers`),
    routeContext(params),
  );
}

function post(
  body: unknown = { email: "manager@example.com" },
  params: Record<string, string> = { publicId: PUBLIC_ID },
  origin = APP_ORIGIN,
) {
  return createManagersPostHandler({ appOrigin: APP_ORIGIN, context: database.context, readSession })(
    new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/managers`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    }),
    routeContext(params),
  );
}

async function expectError(responsePromise: Promise<Response>, status: number, code: string) {
  const response = await responsePromise;
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(code === "VALIDATION_FAILED" ? { fieldErrors: expect.any(Object) } : {}),
    },
  });
}

describe("manager collection handlers", () => {
  it("GET returns the owner-only private list with exact shape", async () => {
    const pendingId = insertManager(database, appointmentId, {
      userId: null,
      email: "pending@example.com",
      createdAt: TEST_NOW,
    });

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ managers: [
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email: "owner@example.com",
        role: "OWNER",
        status: "BOUND",
        canRemove: false,
      },
      {
        id: pendingId,
        email: "pending@example.com",
        role: "COORGANIZER",
        status: "PENDING",
        canRemove: true,
      },
    ] });
  });

  it("POST uses raw session identity and returns exact 201 shape", async () => {
    const response = await post({ email: " MANAGER@EXAMPLE.COM " });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      manager: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        email: "manager@example.com",
        role: "COORGANIZER",
        status: "BOUND",
        canRemove: true,
      },
      revision: 2,
    });
  });

  it("strictly validates GET and POST params and POST bodies", async () => {
    await expectError(get({ publicId: "short" }), 400, "VALIDATION_FAILED");
    await expectError(get({ publicId: PUBLIC_ID, extra: "no" }), 400, "VALIDATION_FAILED");
    await expectError(post({ email: "person@example.com", extra: true }), 400, "VALIDATION_FAILED");
    await expectError(post({ email: "not-an-email" }), 400, "VALIDATION_FAILED");
  });

  it("requires auth and owner access without exposing the list", async () => {
    readSession.mockResolvedValue(null);
    await expectError(get(), 401, "UNAUTHENTICATED");
    readSession.mockResolvedValue(managerSession);
    await expectError(get(), 403, "FORBIDDEN");
    await expectError(post(), 403, "FORBIDDEN");
  });

  it("checks exact Origin before session identity on POST", async () => {
    await expectError(post(undefined, undefined, "https://evil.example"), 403, "ORIGIN_MISMATCH");
    expect(readSession).not.toHaveBeenCalled();
  });

  it("wraps duplicate, cap, and finalized conflicts", async () => {
    insertManager(database, appointmentId, { userId: null, email: "manager@example.com" });
    await expectError(post(), 409, "MANAGER_ALREADY_EXISTS");

    database.connection.db.delete(appointmentManagers)
      .where(eq(appointmentManagers.emailNormalized, "manager@example.com"))
      .run();
    for (let index = 0; index < 20; index += 1) {
      insertManager(database, appointmentId, { userId: null, email: `p${index}@example.com` });
    }
    await expectError(post(), 409, "COORGANIZER_LIMIT_REACHED");

    database.connection.db.delete(appointmentManagers)
      .where(eq(appointmentManagers.role, "COORGANIZER"))
      .run();
    const ownerParticipant = database.connection.db.select({ id: participants.id }).from(participants).get()!;
    finalizeAppointment(database, appointmentId, ownerParticipant.id);
    await expectError(post(), 409, "APPOINTMENT_FINALIZED");
  });
});
