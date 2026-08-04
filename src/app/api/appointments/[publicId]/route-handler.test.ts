import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { appointmentOptions, appointments } from "../../../../db/schema";
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
} from "../../../../features/appointments/server/enrollment-test-support";
import {
  createAppointmentDeleteHandler,
  createAppointmentPatchHandler,
  type AppointmentPatchSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const ownerSession = {
  user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" },
};
const managerSession = {
  user: { id: MANAGER_USER_ID, email: "manager@example.com", name: "Manager" },
};

let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerParticipantId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let readSession: Mock<AppointmentPatchSessionReader>;

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
  readSession = vi.fn().mockResolvedValue(ownerSession);
});

afterEach(() => database.close());

function appointmentRow() {
  const row = database.connection.db.select().from(appointments)
    .where(eq(appointments.id, appointmentId)).get();
  if (!row) throw new Error("Fixture appointment missing");
  return row;
}

function patch(
  body: unknown = { title: "Updated" },
  options: {
    readonly origin?: string | null;
    readonly params?: Record<string, string>;
    readonly rawBody?: string;
  } = {},
): Promise<Response> {
  const handler = createAppointmentPatchHandler({
    appOrigin: APP_ORIGIN,
    context: database.context,
    readSession,
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? APP_ORIGIN);
  const request = new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}`, {
    method: "PATCH",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
  return handler(request, {
    params: Promise.resolve(options.params ?? { publicId: PUBLIC_ID }),
  });
}

function removeAppointment(
  body: unknown = { title: "Planning" },
  options: {
    readonly origin?: string | null;
    readonly params?: Record<string, string>;
    readonly rawBody?: string;
  } = {},
): Promise<Response> {
  const handler = createAppointmentDeleteHandler({
    appOrigin: APP_ORIGIN,
    context: database.context,
    readSession,
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? APP_ORIGIN);
  const request = new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}`, {
    method: "DELETE",
    headers,
    body: options.rawBody ?? JSON.stringify(body),
  });
  return handler(request, {
    params: Promise.resolve(options.params ?? { publicId: PUBLIC_ID }),
  });
}

async function expectError(
  responsePromise: Promise<Response>,
  status: number,
  code: string,
): Promise<void> {
  const response = await responsePromise;
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(code === "VALIDATION_FAILED" ? { fieldErrors: expect.any(Object) } : {}),
    },
  });
}

describe("appointment PATCH handler", () => {
  it("updates details for the owner and returns the exact revision shape", async () => {
    const response = await patch({
      title: "New title",
      description: "New description",
      optionLimit: 11,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 2 });
    expect(appointmentRow()).toMatchObject({
      title: "New title",
      description: "New description",
      type: "DATE",
      optionLimit: 11,
      revision: 2,
      updatedAt: TEST_NOW,
    });
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("updates details for a bound co-organizer", async () => {
    readSession.mockResolvedValue(managerSession);

    const response = await patch({ description: "Managed" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 2 });
    expect(appointmentRow().description).toBe("Managed");
  });

  it("returns 401 for a missing session without a write", async () => {
    readSession.mockResolvedValue(null);

    await expectError(patch(), 401, "UNAUTHENTICATED");

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns 403 for an unbound session without a write", async () => {
    readSession.mockResolvedValue({
      user: { id: "unknown-user", email: "unknown@example.com", name: "Unknown" },
    });

    await expectError(patch(), 403, "FORBIDDEN");

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("requires the exact canonical Origin before auth or writes", async () => {
    await expectError(patch(undefined, { origin: "https://evil.example" }), 403, "ORIGIN_MISMATCH");
    await expectError(patch(undefined, { origin: null }), 403, "ORIGIN_MISMATCH");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly rejects empty, immutable, option, and extra patch bodies", async () => {
    for (const body of [
      {},
      { type: "DATE_TIME" },
      { options: [{ kind: "DATE", startDate: "2031-01-01" }] },
      { title: "No", extra: true },
    ]) {
      await expectError(patch(body), 400, "VALIDATION_FAILED");
    }

    expect(appointmentRow()).toMatchObject({
      title: "Planning",
      type: "DATE",
      optionLimit: 10,
      revision: 1,
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects invalid mutable values and malformed JSON without writes", async () => {
    for (const body of [
      { title: "   " },
      { title: "x".repeat(121) },
      { description: "x".repeat(2_001) },
      { optionLimit: 1.5 },
      { optionLimit: 101 },
    ]) {
      await expectError(patch(body), 400, "VALIDATION_FAILED");
    }
    await expectError(patch(undefined, { rawBody: "{" }), 400, "VALIDATION_FAILED");

    expect(appointmentRow()).toMatchObject({ title: "Planning", optionLimit: 10, revision: 1 });
    expect(readSession).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly validates route params before auth or writes", async () => {
    await expectError(patch(undefined, { params: { publicId: "short" } }), 400, "VALIDATION_FAILED");
    await expectError(patch(undefined, {
      params: { publicId: PUBLIC_ID, extra: "no" },
    }), 400, "VALIDATION_FAILED");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
  });

  it("returns 409 without writes when the appointment is finalized", async () => {
    finalizeAppointment(database, appointmentId, ownerParticipantId);

    await expectError(patch(), 409, "APPOINTMENT_FINALIZED");

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns 409 when the limit is below the current option count", async () => {
    database.connection.db.insert(appointmentOptions).values([
      {
        appointmentId,
        creatorParticipantId: ownerParticipantId,
        startDate: "2030-01-01",
        canonicalKey: "D:2030-01-01",
        createdAt: TEST_NOW,
      },
      {
        appointmentId,
        creatorParticipantId: ownerParticipantId,
        startDate: "2030-01-02",
        canonicalKey: "D:2030-01-02",
        createdAt: TEST_NOW,
      },
    ]).run();

    await expectError(patch({ optionLimit: 1 }), 409, "LIMIT_BELOW_CURRENT_COUNT");

    expect(appointmentRow()).toMatchObject({ optionLimit: 10, revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps a no-op revision and timestamp unchanged without publishing", async () => {
    const response = await patch({ title: "Planning", description: null, optionLimit: 10 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 1 });
    expect(appointmentRow()).toMatchObject({ revision: 1, updatedAt: TEST_NOW });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("appointment DELETE handler", () => {
  it("deletes an active appointment for the owner and returns an empty 204", async () => {
    const response = await removeAppointment();

    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
    expect(appointmentRow).toThrow("Fixture appointment missing");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("deletes a finalized appointment without exposing an intermediate response", async () => {
    finalizeAppointment(database, appointmentId, ownerParticipantId);

    const response = await removeAppointment();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(appointmentRow).toThrow("Fixture appointment missing");
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("requires the exact canonical Origin before params, body, session, or writes", async () => {
    await expectError(removeAppointment(undefined, {
      origin: "https://evil.example",
      params: { publicId: "short" },
      rawBody: "{",
    }), 403, "ORIGIN_MISMATCH");
    await expectError(removeAppointment(undefined, { origin: null }), 403, "ORIGIN_MISMATCH");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly validates params before parsing the body or reading the session", async () => {
    const invalidParams: Array<Record<string, string>> = [
      { publicId: "short" },
      { publicId: PUBLIC_ID, extra: "no" },
    ];
    for (const params of invalidParams) {
      await expectError(removeAppointment(undefined, {
        params,
        rawBody: "{",
      }), 400, "VALIDATION_FAILED");
    }

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ revision: 1 });
  });

  it("strictly validates the exact title body before reading the session", async () => {
    for (const body of [
      {},
      { title: 42 },
      { title: "Planning", extra: true },
    ]) {
      await expectError(removeAppointment(body), 400, "VALIDATION_FAILED");
    }
    await expectError(removeAppointment(undefined, { rawBody: "{" }), 400, "VALIDATION_FAILED");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("requires a valid Better Auth session before service authorization", async () => {
    readSession.mockResolvedValue(null);

    await expectError(removeAppointment(), 401, "UNAUTHENTICATED");

    expect(appointmentRow()).toMatchObject({ revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for co-organizers and authenticated nonmanagers", async () => {
    readSession.mockResolvedValue(managerSession);
    await expectError(removeAppointment(), 403, "FORBIDDEN");

    readSession.mockResolvedValue({
      user: { id: "unknown-user", email: "unknown@example.com", name: "Unknown" },
    });
    await expectError(removeAppointment(), 403, "FORBIDDEN");

    expect(appointmentRow()).toMatchObject({ revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns the stable exact-title mismatch without deleting", async () => {
    for (const title of ["planning", "Planning "]) {
      await expectError(removeAppointment({ title }), 400, "TITLE_CONFIRMATION_MISMATCH");
    }

    expect(appointmentRow()).toMatchObject({ title: "Planning", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an unknown appointment", async () => {
    await expectError(removeAppointment(undefined, {
      params: { publicId: "zyxwvutsrqponmlkjihgfedc" },
    }), 404, "NOT_FOUND");

    expect(appointmentRow()).toMatchObject({ revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });
});
