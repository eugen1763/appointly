import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appointments, rateLimitWindows } from "../../../db/schema";
import {
  createRateKeyDigester,
  type RateKeyDigester,
} from "../../../lib/security";
import { AppError, appErrorResponse } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertUser,
  OWNER_USER_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import {
  deleteExpiredRateLimitWindows,
  JOIN_RATE_LIMIT,
  JOIN_RATE_WINDOW_MS,
  PUBLIC_WRITE_RATE_LIMIT,
  PUBLIC_WRITE_RATE_WINDOW_MS,
  consumeJoinRateLimit,
  consumePublicWriteRateLimit,
} from "./rate-limit";
import { runImmediate } from "./transactions";

const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x61));
const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000111";
const SESSION_HASH = Buffer.alloc(32, 0x62);

let database: EnrollmentTestDatabase;
let appointmentId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
});

afterEach(() => database.close());

function consumeJoin(
  now: number,
  overrides: Partial<Parameters<typeof consumeJoinRateLimit>[1]> = {},
  digester: RateKeyDigester = RATE_DIGESTER,
): void {
  runImmediate(database.context, (context) => {
    deleteExpiredRateLimitWindows(context, now);
    consumeJoinRateLimit(context, {
      appointmentId,
      guestSessionHash: null,
      clientKey: "direct-client",
      now,
      ...overrides,
    }, digester);
  });
}

function expectRateError(operation: () => unknown, retryAfterSeconds: number): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    code: "RATE_LIMITED",
    message: "Too many requests. Try again later.",
    retryAfterSeconds,
  });
}

describe("rate key digests", () => {
  it("uses deterministic length-prefixed rate-domain HMAC values", () => {
    const first = RATE_DIGESTER.digestRateKey("join", "ab", "c");
    expect(first).toHaveLength(32);
    expect(first).toEqual(RATE_DIGESTER.digestRateKey("join", "ab", "c"));
    expect(first).not.toEqual(RATE_DIGESTER.digestRateKey("join", "a", "bc"));
    expect(first).not.toEqual(createRateKeyDigester(Buffer.alloc(32, 0x62))
      .digestRateKey("join", "ab", "c"));
  });

  it("requires at least 32 secret bytes", () => {
    expect(() => createRateKeyDigester(Buffer.alloc(31))).toThrow(/32 bytes/u);
  });
});

describe("fixed rate windows", () => {
  it("counts ten accepted joins and rejects the next without incrementing", async () => {
    for (let count = 0; count < JOIN_RATE_LIMIT; count += 1) {
      consumeJoin(TEST_NOW);
    }
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count)
      .toBe(JOIN_RATE_LIMIT);

    expectRateError(() => consumeJoin(TEST_NOW + 1_000), 3_599);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count)
      .toBe(JOIN_RATE_LIMIT);

    let error: AppError | undefined;
    try {
      consumeJoin(TEST_NOW + 1_000);
    } catch (caught) {
      error = caught as AppError;
    }
    const response = appErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3599");
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again later.",
      },
    });
  });

  it("resets at the exact fixed-window boundary and removes unrelated expired rows", () => {
    consumeJoin(TEST_NOW);
    const expiredKey = Buffer.alloc(32, 0x7f);
    database.connection.db.insert(rateLimitWindows).values({
      key: expiredKey,
      count: 7,
      windowStartedAt: TEST_NOW - 10_000,
      expiresAt: TEST_NOW + 1,
    }).run();

    consumeJoin(TEST_NOW + JOIN_RATE_WINDOW_MS);

    const rows = database.connection.db.select().from(rateLimitWindows).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      count: 1,
      windowStartedAt: TEST_NOW + JOIN_RATE_WINDOW_MS,
      expiresAt: TEST_NOW + (2 * JOIN_RATE_WINDOW_MS),
    });
  });

  it("separates session, client, operation, appointment, and actor kinds", () => {
    runImmediate(database.context, (context) => {
      deleteExpiredRateLimitWindows(context, TEST_NOW);
      consumeJoinRateLimit(context, {
        appointmentId,
        guestSessionHash: null,
        clientKey: "198.51.100.7",
        now: TEST_NOW,
      }, RATE_DIGESTER);
      consumeJoinRateLimit(context, {
        appointmentId,
        guestSessionHash: SESSION_HASH,
        clientKey: "198.51.100.7",
        now: TEST_NOW,
      }, RATE_DIGESTER);
      consumeJoinRateLimit(context, {
        appointmentId: APPOINTMENT_ID,
        guestSessionHash: null,
        clientKey: "198.51.100.7",
        now: TEST_NOW,
      }, RATE_DIGESTER);
      consumePublicWriteRateLimit(context, {
        appointmentId,
        actor: { kind: "user", id: OWNER_USER_ID },
        now: TEST_NOW,
      }, RATE_DIGESTER);
      consumePublicWriteRateLimit(context, {
        appointmentId,
        actor: { kind: "participant", id: OWNER_USER_ID },
        now: TEST_NOW,
      }, RATE_DIGESTER);
    });

    const rows = database.connection.db.select().from(rateLimitWindows).all();
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.key.toString("hex"))).size).toBe(5);
    expect(rows.filter((row) => row.expiresAt === TEST_NOW + JOIN_RATE_WINDOW_MS)).toHaveLength(3);
    expect(rows.filter((row) => row.expiresAt === TEST_NOW + PUBLIC_WRITE_RATE_WINDOW_MS)).toHaveLength(2);
    expect(PUBLIC_WRITE_RATE_LIMIT).toBe(120);
  });

  it("rejects a non-32-byte digest and never changes appointment revision", () => {
    expect(() => consumeJoin(TEST_NOW, {}, {
      digestRateKey: () => Buffer.alloc(31),
    })).toThrow(/32 bytes/u);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(database.connection.db.select({ revision: appointments.revision })
      .from(appointments).where(eq(appointments.id, appointmentId)).get()?.revision).toBe(1);
  });
});
