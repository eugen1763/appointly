import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../../../db/schema";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertParticipant,
  insertUser,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "../../../../../features/appointments/server/enrollment-test-support";
import { createGuestTokenDigester } from "../../../../../lib/security";
import { createGuestAccessPostHandler } from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const EDIT_TOKEN = Buffer.alloc(32, 0x51);
const SESSION_TOKEN = Buffer.alloc(32, 0x52);
const EXISTING_SESSION_TOKEN = Buffer.alloc(32, 0x53);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x6b));
const INVALID_BODY = {
  participantId: "bad",
  token: "bad",
};

let database: EnrollmentTestDatabase;
let participantId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  const appointmentId = insertAppointment(database);
  participantId = insertParticipant(database, appointmentId, "Avery");
  database.connection.db.update(participants)
    .set({ editTokenHash: TOKEN_DIGESTER.digestEditToken(EDIT_TOKEN) })
    .where(eq(participants.id, participantId))
    .run();
});

afterEach(() => database.close());

function post(options: {
  origin?: string;
  body?: unknown;
  rawBody?: string;
  publicId?: string;
  cookie?: string;
  params?: Promise<Record<string, string>>;
  tokenFactory?: () => Buffer;
} = {}): Promise<Response> {
  const handler = createGuestAccessPostHandler({
    appOrigin: APP_ORIGIN,
    context: {
      ...database.context,
      tokenFactory: options.tokenFactory ?? (() => Buffer.from(SESSION_TOKEN)),
    },
    tokenDigester: TOKEN_DIGESTER,
  });
  const headers = new Headers({
    "content-type": "application/json",
    origin: options.origin ?? APP_ORIGIN,
  });
  if (options.cookie !== undefined) {
    headers.set("cookie", `appointly_guest_session=${options.cookie}`);
  }
  const publicId = options.publicId ?? PUBLIC_ID;
  return handler(new Request(`${APP_ORIGIN}/api/appointments/${publicId}/guest-access`, {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? {
      participantId,
      token: EDIT_TOKEN.toString("base64url"),
    }),
  }), {
    params: options.params ?? Promise.resolve({ publicId }),
  });
}

const invalidBody = {
  error: {
    code: "INVALID_EDIT_LINK",
    message: "This private edit link is invalid or no longer available.",
  },
};

describe("guest-access POST handler", () => {
  it("returns exact success and sets the fixed secure cookie only for a new session", async () => {
    const response = await post();

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ participantId });
    expect(response.headers.get("set-cookie")).toBe(
      `appointly_guest_session=${SESSION_TOKEN.toString("base64url")}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(JSON.stringify(responseBody)).not.toContain(EDIT_TOKEN.toString("base64url"));
  });

  it("reuses a valid cookie without resetting it and updates lastSeen only", async () => {
    const sessionHash = TOKEN_DIGESTER.digestSessionToken(EXISTING_SESSION_TOKEN);
    database.connection.db.insert(guestSessions).values({
      tokenHash: sessionHash,
      createdAt: TEST_NOW - 100,
      expiresAt: TEST_NOW + 100,
      lastSeenAt: TEST_NOW - 50,
    }).run();
    const tokenFactory = vi.fn(() => { throw new Error("must not replace session"); });

    const response = await post({
      cookie: EXISTING_SESSION_TOKEN.toString("base64url"),
      tokenFactory,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select().from(guestSessions).all()).toEqual([{
      tokenHash: sessionHash,
      createdAt: TEST_NOW - 100,
      expiresAt: TEST_NOW + 100,
      lastSeenAt: TEST_NOW,
    }]);
    expect(database.connection.db.select().from(guestSessionAccess).all()).toEqual([{
      sessionTokenHash: sessionHash,
      participantId,
      createdAt: TEST_NOW,
    }]);
  });

  it.each([
    ["malformed JSON", { rawBody: "{" }],
    ["missing fields", { body: {} }],
    ["extra fields", { body: { ...INVALID_BODY, extra: "secret" } }],
    ["malformed public ID", { publicId: "bad" }],
    ["malformed participant ID", { body: { participantId: "bad", token: EDIT_TOKEN.toString("base64url") } }],
    ["malformed token", { body: { participantId: "00000000-0000-4000-8000-000000000123", token: "bad" } }],
  ])("returns the identical fixed 403 for %s", async (_case, options) => {
    const response = await post(options);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(invalidBody);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("checks exact Origin before params, JSON, cookies, or database work", async () => {
    const then = vi.fn(() => { throw new Error("params must not be read"); });
    const params = { then } as unknown as Promise<Record<string, string>>;

    const response = await post({
      origin: "https://evil.example",
      rawBody: "{",
      cookie: "not-a-cookie",
      params,
      tokenFactory: () => { throw new Error("database work must not run"); },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "ORIGIN_MISMATCH",
        message: "The request origin does not match this application.",
      },
    });
    expect(then).not.toHaveBeenCalled();
  });

  it("maps unexpected service faults to a stable non-leaking response", async () => {
    const response = await post({ tokenFactory: () => { throw new Error("token factory secret"); } });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not open the private edit link.",
      },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
