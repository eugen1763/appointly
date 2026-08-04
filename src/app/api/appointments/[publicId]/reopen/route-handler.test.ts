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
  createReopenAppointmentPostHandler,
  type ReopenAppointmentSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const ownerSession = {
  user: { id: OWNER_USER_ID, email: "owner@example.com", name: "Owner" },
};

let database: EnrollmentTestDatabase;
let appointmentId: string;
let optionId: string;
let publish: Mock<(appointmentId: string, revision: number) => void>;
let readSession: Mock<ReopenAppointmentSessionReader>;

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
  const participantId = insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  optionId = database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId: participantId,
    startDate: "2030-01-01",
    canonicalKey: "D:2030-01-01",
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
  database.connection.db.update(appointments).set({
    status: "FINALIZED",
    finalOptionId: optionId,
  }).where(eq(appointments.id, appointmentId)).run();
  readSession = vi.fn().mockResolvedValue(ownerSession);
});

afterEach(() => database.close());

function post(options: {
  readonly origin?: string | null;
  readonly params?: Record<string, string>;
  readonly body?: string;
} = {}): Promise<Response> {
  const handler = createReopenAppointmentPostHandler({
    appOrigin: APP_ORIGIN,
    context: database.context,
    readSession,
  });
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? APP_ORIGIN);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return handler(new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/reopen`, {
    method: "POST",
    headers,
    body: options.body,
  }), {
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

describe("appointment reopen POST handler", () => {
  it("reopens for an authenticated bound manager and returns only the revision", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 2 });
    expect(database.connection.db.select().from(appointments)
      .where(eq(appointments.id, appointmentId)).get()).toMatchObject({
      status: "ACTIVE",
      finalOptionId: null,
      revision: 2,
    });
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("requires the exact canonical Origin before params, body, session, or writes", async () => {
    await expectError(post({
      origin: "https://evil.example",
      params: { publicId: "short" },
      body: "{}",
    }), 403, "ORIGIN_MISMATCH");
    await expectError(post({ origin: null }), 403, "ORIGIN_MISMATCH");

    expect(readSession).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("accepts an absent or zero-byte body but rejects content before reading the session", async () => {
    const zeroByteResponse = await post({ body: "" });
    expect(zeroByteResponse.status).toBe(200);

    database.connection.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: optionId,
      revision: 1,
    }).where(eq(appointments.id, appointmentId)).run();
    readSession.mockClear();
    publish.mockClear();

    await expectError(post({ body: "{}" }), 400, "VALIDATION_FAILED");
    expect(readSession).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("strictly validates route params before body, session, or writes", async () => {
    const invalidParams: Array<Record<string, string>> = [
      { publicId: "short" },
      { publicId: PUBLIC_ID, extra: "no" },
    ];
    for (const params of invalidParams) {
      await expectError(post({ params, body: "{}" }), 400, "VALIDATION_FAILED");
    }

    expect(readSession).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("returns UNAUTHENTICATED for a missing manager session", async () => {
    readSession.mockResolvedValue(null);
    await expectError(post(), 401, "UNAUTHENTICATED");
    expect(publish).not.toHaveBeenCalled();
  });

  it("preserves FORBIDDEN and NOT_FOUND service responses", async () => {
    readSession.mockResolvedValue({
      user: { id: "unbound-user", email: "unbound@example.com", name: "Unbound" },
    });
    await expectError(post(), 403, "FORBIDDEN");

    readSession.mockResolvedValue(ownerSession);
    await expectError(post({ params: { publicId: OTHER_PUBLIC_ID } }), 404, "NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });

  it("rethrows unexpected service failures", async () => {
    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_route_reopen
      BEFORE UPDATE OF status ON appointments
      WHEN NEW.status = 'ACTIVE'
      BEGIN
        SELECT RAISE(ABORT, 'unexpected reopen failure');
      END
    `);

    await expect(post()).rejects.toThrow("unexpected reopen failure");
    expect(publish).not.toHaveBeenCalled();
  });
});
