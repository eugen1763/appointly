import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  appointmentManagers,
  guestSessions,
  participants,
  rateLimitWindows,
} from "../../../../../db/schema";
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
  createGuestTokenDigester,
  createRateKeyDigester,
  type GuestTokenDigester,
} from "../../../../../lib/security";
import type { ManagerSession } from "../../../../../lib/auth-session";
import {
  createParticipantPostHandler,
  type ParticipantSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const EDIT_TOKEN = Buffer.alloc(32, 0x51);
const SESSION_TOKEN = Buffer.alloc(32, 0x52);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x6b));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x6c));
const MANAGER_SESSION: ManagerSession = {
  user: {
    id: MANAGER_USER_ID,
    email: "manager@example.com",
    name: "Manager",
  },
};

let database: EnrollmentTestDatabase;
let appointmentId: string;
let readSession: Mock<ParticipantSessionReader>;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  insertManager(database, appointmentId, {
    userId: OWNER_USER_ID,
    email: "owner@example.com",
    role: "OWNER",
  });
  insertParticipant(database, appointmentId, "Owner", OWNER_USER_ID);
  readSession = vi.fn().mockResolvedValue(null);
});

afterEach(() => database.close());

function post(options: {
  body?: unknown;
  origin?: string;
  appOrigin?: string;
  cookie?: string;
  params?: Record<string, string>;
  tokens?: readonly Buffer[];
  tokenDigester?: GuestTokenDigester;
  trustProxy?: boolean;
  forwardedFor?: string;
} = {}): Promise<Response> {
  let tokenIndex = 0;
  const tokens = options.tokens ?? [EDIT_TOKEN, SESSION_TOKEN];
  const context = {
    ...database.context,
    tokenFactory: () => Buffer.from(tokens[tokenIndex++] ?? Buffer.alloc(0)),
  };
  const appOrigin = options.appOrigin ?? APP_ORIGIN;
  const handler = createParticipantPostHandler({
    appOrigin,
    context,
    readSession,
    tokenDigester: options.tokenDigester ?? TOKEN_DIGESTER,
    rateKeyDigester: RATE_DIGESTER,
    trustProxy: options.trustProxy ?? false,
  });
  const headers = new Headers({
    "content-type": "application/json",
    origin: options.origin ?? appOrigin,
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.forwardedFor !== undefined) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }
  return handler(new Request(`${appOrigin}/api/appointments/${PUBLIC_ID}/participants`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? { displayName: "Avery" }),
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
  expect(await response.json()).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(code === "VALIDATION_FAILED" ? { fieldErrors: expect.any(Object) } : {}),
    },
  });
}

describe("participant POST handler", () => {
  it("returns the exact guest body and secure fixed cookie", async () => {
    const response = await post();

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      editUrl: `/a/${PUBLIC_ID}/edit#participant=${body.participantId as string}&token=${EDIT_TOKEN.toString("base64url")}`,
      revision: 2,
    });
    expect(Object.keys(body).sort()).toEqual(["editUrl", "participantId", "revision"]);
    expect(response.headers.get("set-cookie")).toBe(
      `appointly_guest_session=${SESSION_TOKEN.toString("base64url")}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("omits Secure exactly for an HTTP app origin", async () => {
    const response = await post({ appOrigin: "http://127.0.0.1:3000" });
    expect(response.headers.get("set-cookie")).toBe(
      `appointly_guest_session=${SESSION_TOKEN.toString("base64url")}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );
  });

  it("returns the exact pending-manager body without any cookie or private link", async () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
      role: "COORGANIZER",
    });
    readSession.mockResolvedValue(MANAGER_SESSION);

    const response = await post({ body: { displayName: "Manager Guest" } });

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      participantId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision: 2,
    });
    expect(Object.keys(body).sort()).toEqual(["participantId", "revision"]);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(database.connection.db.select({ userId: appointmentManagers.userId })
      .from(appointmentManagers)
      .where(eq(appointmentManagers.emailNormalized, "manager@example.com")).get()?.userId)
      .toBe(MANAGER_USER_ID);
  });

  it("does not reset a reused valid session cookie on another appointment", async () => {
    const first = await post();
    const rawCookie = first.headers.get("set-cookie")?.split(";", 1)[0];
    expect(rawCookie).toBeTruthy();
    const secondPublicId = "zyxwvutsrqponmlkjihgfedc";
    const secondAppointmentId = insertAppointment(database, OWNER_USER_ID, secondPublicId);
    insertParticipant(database, secondAppointmentId, "Second owner", OWNER_USER_ID);

    const second = await post({
      body: { displayName: "Blake" },
      cookie: rawCookie,
      params: { publicId: secondPublicId },
    });
    expect(second.status).toBe(201);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(database.connection.db.select().from(guestSessions).all()).toHaveLength(1);
  });

  it("passes only the trusted leftmost proxy address into the join rate bucket", async () => {
    const response = await post({
      trustProxy: true,
      forwardedFor: " 198.51.100.7, 10.0.0.4 ",
    });
    expect(response.status).toBe(201);

    const key = RATE_DIGESTER.digestRateKey(
      "join",
      appointmentId,
      "client",
      "198.51.100.7",
    );
    expect(database.connection.db.select().from(rateLimitWindows).get()?.key).toEqual(key);
  });

  it("checks exact Origin before params, body, cookie, session, or database work", async () => {
    await expectError(post({
      origin: "https://evil.example",
      body: { displayName: "Avery", extra: true },
      params: { publicId: "bad" },
      cookie: "appointly_guest_session=bad",
    }), 403, "ORIGIN_MISMATCH");

    expect(readSession).not.toHaveBeenCalled();
    expect(database.connection.db.select().from(participants).all()).toHaveLength(1);
  });

  it("uses stable validation and domain errors", async () => {
    await expectError(post({ body: { displayName: "Avery", extra: true } }), 400, "VALIDATION_FAILED");
    await expectError(post({ params: { publicId: "short" } }), 400, "VALIDATION_FAILED");
    insertParticipant(database, appointmentId, "Avery");
    await expectError(post(), 409, "NAME_TAKEN");
  });

  it("returns an exact non-leaking INTERNAL_ERROR for unexpected service faults", async () => {
    const response = await post({ tokens: [Buffer.alloc(31)] });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not join the appointment.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("32");
    expect(JSON.stringify(body)).not.toContain("cause");
  });

  it("returns the same non-leaking INTERNAL_ERROR for route dependency faults", async () => {
    readSession.mockRejectedValue(new Error("session reader secret"));

    const response = await post();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not join the appointment.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("session reader secret");
  });
});
