import { eq } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { appointmentManagers, appointments, participants } from "../../../../../db/schema";
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
  createManagerParticipantPostHandler,
  type ManagerParticipantSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const managerSession = {
  user: {
    id: MANAGER_USER_ID,
    email: "manager@example.com",
    name: "Manager",
  },
};

let database: EnrollmentTestDatabase;
let appointmentId: string;
let readSession: Mock<ManagerParticipantSessionReader>;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId);
  insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  readSession = vi.fn().mockResolvedValue(managerSession);
});

afterEach(() => database.close());

function post(
  body: unknown = { displayName: "Manager Name" },
  params: Record<string, string> = { publicId: PUBLIC_ID },
  origin = APP_ORIGIN,
) {
  const handler = createManagerParticipantPostHandler({
    appOrigin: APP_ORIGIN,
    context: database.context,
    readSession,
  });
  const request = new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/manager-participant`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve(params) });
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

describe("manager participant POST handler", () => {
  it("returns 201 for a new linked participant", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision: 2,
    });
  });

  it("binds a pending matching session email in the enrollment transaction", async () => {
    database.connection.db.update(appointmentManagers)
      .set({ userId: null })
      .where(eq(appointmentManagers.appointmentId, appointmentId))
      .run();

    const response = await post();

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ revision: 2 });
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers).get()?.userId).toBe(MANAGER_USER_ID);
  });

  it("returns idempotent 200 with the current revision", async () => {
    const participantId = insertParticipant(database, appointmentId, "Existing", MANAGER_USER_ID);

    const response = await post({ displayName: "Ignored" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ participantId, revision: 1 });
  });

  it("strictly rejects invalid params", async () => {
    await expectError(post({ displayName: "Manager" }, { publicId: "short" }), 400, "VALIDATION_FAILED");
    await expectError(post(
      { displayName: "Manager" },
      { publicId: PUBLIC_ID, extra: "no" },
    ), 400, "VALIDATION_FAILED");
  });

  it("strictly rejects invalid request bodies", async () => {
    await expectError(post({ displayName: "Manager", extra: true }), 400, "VALIDATION_FAILED");
    await expectError(post({ displayName: "   " }), 400, "VALIDATION_FAILED");
  });

  it("requires a Better Auth session identity", async () => {
    readSession.mockResolvedValue(null);
    await expectError(post(), 401, "UNAUTHENTICATED");
  });

  it("requires the identity to be a bound manager", async () => {
    readSession.mockResolvedValue({
      user: {
        id: "00000000-0000-4000-8000-000000000003",
        email: "other@example.com",
        name: "Other",
      },
    });
    await expectError(post(), 403, "FORBIDDEN");
  });

  it("returns NAME_TAKEN in the stable wrapper", async () => {
    insertParticipant(database, appointmentId, "Manager Name");
    await expectError(post(), 409, "NAME_TAKEN");
  });

  it("returns the conflict after committing pending binding and its revision", async () => {
    database.connection.db.update(appointmentManagers)
      .set({ userId: null })
      .where(eq(appointmentManagers.appointmentId, appointmentId))
      .run();
    insertParticipant(database, appointmentId, "Manager Name");
    const publish = vi.spyOn(database.context.eventPublisher, "publish");

    await expectError(post(), 409, "NAME_TAKEN");

    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers).get()?.userId).toBe(MANAGER_USER_ID);
    expect(database.connection.db.select({ revision: appointments.revision })
      .from(appointments).get()?.revision).toBe(2);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith(appointmentId, 2);
  });

  it("returns PARTICIPANT_LIMIT_REACHED in the stable wrapper", async () => {
    database.connection.db.insert(participants).values(
      Array.from({ length: 199 }, (_, index) => ({
        appointmentId,
        userId: null,
        displayName: `Guest ${index}`,
        normalizedName: `guest ${index}`,
        editTokenHash: null,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      })),
    ).run();
    await expectError(post(), 409, "PARTICIPANT_LIMIT_REACHED");
  });

  it("returns APPOINTMENT_FINALIZED in the stable wrapper", async () => {
    const owner = database.connection.sqlite
      .prepare("SELECT id FROM participants WHERE appointment_id = ? AND user_id = ?")
      .pluck().get(appointmentId, OWNER_USER_ID) as string;
    finalizeAppointment(database, appointmentId, owner);
    await expectError(post(), 409, "APPOINTMENT_FINALIZED");
  });

  it("rejects a missing or non-exact Origin before reading the session", async () => {
    await expectError(post(undefined, undefined, "https://evil.example"), 403, "ORIGIN_MISMATCH");
    expect(readSession).not.toHaveBeenCalled();
  });
});
