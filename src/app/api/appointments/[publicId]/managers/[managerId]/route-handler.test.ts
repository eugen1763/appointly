import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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
  type EnrollmentTestDatabase,
} from "../../../../../../features/appointments/server/enrollment-test-support";
import {
  createManagerDeleteHandler,
  type ManagerDeleteSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const ownerSession = { user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" } };
const managerSession = { user: { id: MANAGER_USER_ID, email: "manager@example.com", name: "Manager" } };
let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerManagerId: string;
let managerId: string;
let ownerParticipantId: string;
let readSession: Mock<ManagerDeleteSessionReader>;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  ownerManagerId = insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
  });
  managerId = insertManager(database, appointmentId);
  ownerParticipantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  readSession = vi.fn().mockResolvedValue(ownerSession);
});

afterEach(() => database.close());

/*
 * A synthetic Request with `body: undefined` gets `body: null` from undici, but a
 * real one arrives with a stream attached whatever the method. That gap hid a guard
 * here that rejected every browser DELETE until `editing-surfaces.spec.ts` drove the
 * removal through a real browser. This harness cannot see that class of bug, so the
 * end-to-end coverage is the guarantee — do not replace it with a request built here.
 */
function del(
  params: Record<string, string> = { publicId: PUBLIC_ID, managerId },
  origin = APP_ORIGIN,
  body?: string,
) {
  const request = new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/managers/${managerId}`, {
    method: "DELETE",
    headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body,
  });
  return createManagerDeleteHandler({ appOrigin: APP_ORIGIN, context: database.context, readSession })(
    request,
    { params: Promise.resolve(params) },
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

describe("manager DELETE handler", () => {
  it("returns the exact revision shape", async () => {
    const response = await del();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 2 });
  });

  it("strictly rejects invalid params and any request body", async () => {
    await expectError(del({ publicId: "short", managerId }), 400, "VALIDATION_FAILED");
    await expectError(del({ publicId: PUBLIC_ID, managerId, extra: "no" }), 400, "VALIDATION_FAILED");
    await expectError(del({ publicId: PUBLIC_ID, managerId: "not-a-uuid" }), 400, "VALIDATION_FAILED");
    await expectError(del(undefined, undefined, "{}"), 400, "VALIDATION_FAILED");
  });

  it("requires exact Origin before reading the session", async () => {
    await expectError(del(undefined, "https://evil.example"), 403, "ORIGIN_MISMATCH");
    expect(readSession).not.toHaveBeenCalled();
  });

  it("requires a Better Auth identity and owner access", async () => {
    readSession.mockResolvedValue(null);
    await expectError(del(), 401, "UNAUTHENTICATED");
    readSession.mockResolvedValue(managerSession);
    await expectError(del(), 403, "FORBIDDEN");
  });

  it("wraps owner protection, not-found, and finalized errors", async () => {
    await expectError(del({ publicId: PUBLIC_ID, managerId: ownerManagerId }), 403, "FORBIDDEN");
    await expectError(del({
      publicId: PUBLIC_ID,
      managerId: "00000000-0000-4000-8000-000000000099",
    }), 404, "NOT_FOUND");
    finalizeAppointment(database, appointmentId, ownerParticipantId);
    await expectError(del(), 409, "APPOINTMENT_FINALIZED");
  });
});
