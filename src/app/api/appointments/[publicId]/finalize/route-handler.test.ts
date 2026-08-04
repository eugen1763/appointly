import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { appointmentOptions, appointments } from "../../../../../db/schema";
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
} from "../../../../../features/appointments/server/enrollment-test-support";
import {
  createFinalizeAppointmentPostHandler,
  type FinalizeAppointmentSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const MISSING_OPTION_ID = "00000000-0000-4000-8000-000000000099";
const ownerSession = {
  user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" },
};

let database: EnrollmentTestDatabase;
let appointmentId: string;
let ownerParticipantId: string;
let optionId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let readSession: Mock<FinalizeAppointmentSessionReader>;

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
  optionId = database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId: ownerParticipantId,
    startDate: "2030-01-01",
    canonicalKey: "D:2030-01-01",
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
  readSession = vi.fn().mockResolvedValue(ownerSession);
});

afterEach(() => database.close());

function appointmentRow() {
  const row = database.connection.db.select().from(appointments)
    .where(eq(appointments.id, appointmentId)).get();
  if (!row) throw new Error("Fixture appointment missing");
  return row;
}

function post(
  body: unknown = { optionId },
  options: {
    readonly origin?: string | null;
    readonly params?: Record<string, string>;
    readonly rawBody?: string;
  } = {},
): Promise<Response> {
  const handler = createFinalizeAppointmentPostHandler({
    appOrigin: APP_ORIGIN,
    context: database.context,
    readSession,
  });
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? APP_ORIGIN);
  const request = new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/finalize`, {
    method: "POST",
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

describe("appointment finalize POST handler", () => {
  it("finalizes for an authenticated bound manager and returns the exact revision shape", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 2 });
    expect(appointmentRow()).toMatchObject({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 2,
    });
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("requires the exact canonical Origin before parsing, auth, or writes", async () => {
    await expectError(post(undefined, {
      origin: "https://evil.example",
      rawBody: "{",
      params: { publicId: "short" },
    }), 403, "ORIGIN_MISMATCH");
    await expectError(post(undefined, { origin: null }), 403, "ORIGIN_MISMATCH");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly validates route params before auth or writes", async () => {
    await expectError(post(undefined, {
      params: { publicId: "short" },
    }), 400, "VALIDATION_FAILED");
    await expectError(post(undefined, {
      params: { publicId: PUBLIC_ID, extra: "no" },
    }), 400, "VALIDATION_FAILED");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly validates the body and malformed JSON before auth or writes", async () => {
    for (const body of [
      {},
      { optionId: "not-a-uuid" },
      { optionId, extra: true },
    ]) {
      await expectError(post(body), 400, "VALIDATION_FAILED");
    }
    await expectError(post(undefined, { rawBody: "{" }), 400, "VALIDATION_FAILED");

    expect(readSession).not.toHaveBeenCalled();
    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns UNAUTHENTICATED for a missing manager session", async () => {
    readSession.mockResolvedValue(null);

    await expectError(post(), 401, "UNAUTHENTICATED");

    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns FORBIDDEN for an authenticated but unbound user", async () => {
    readSession.mockResolvedValue({
      user: { id: "unbound-user", email: "unbound@example.com", name: "Unbound" },
    });

    await expectError(post(), 403, "FORBIDDEN");

    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an unknown appointment", async () => {
    await expectError(post(undefined, {
      params: { publicId: OTHER_PUBLIC_ID },
    }), 404, "NOT_FOUND");

    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns INVALID_FINAL_OPTION for a missing option without writes", async () => {
    await expectError(post({ optionId: MISSING_OPTION_ID }), 409, "INVALID_FINAL_OPTION");

    expect(appointmentRow()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 1,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns APPOINTMENT_FINALIZED for an already finalized appointment without writes", async () => {
    database.connection.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: optionId,
    }).where(eq(appointments.id, appointmentId)).run();

    await expectError(post(), 409, "APPOINTMENT_FINALIZED");

    expect(appointmentRow()).toMatchObject({ status: "FINALIZED", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("rethrows unexpected service failures", async () => {
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_route_finalization
      BEFORE UPDATE OF status ON appointments
      WHEN NEW.status = 'FINALIZED'
      BEGIN
        SELECT RAISE(ABORT, 'unexpected finalization failure');
      END
    `);

    await expect(post()).rejects.toThrow("unexpected finalization failure");
    expect(appointmentRow()).toMatchObject({ status: "ACTIVE", revision: 1 });
    expect(publish).not.toHaveBeenCalled();
  });
});
