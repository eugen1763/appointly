import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appointmentManagers,
  guestSessions,
  participants,
  rateLimitWindows,
} from "../../../db/schema";
import {
  createGuestTokenDigester,
  createRateKeyDigester,
} from "../../../lib/security";
import { AppError } from "../http-errors";
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
} from "./enrollment-test-support";
import { joinParticipant } from "./guest-access";
import {
  consumeJoinRateLimit,
  deleteExpiredRateLimitWindows,
  JOIN_RATE_LIMIT,
} from "./rate-limit";
import type { ServiceContext } from "./service-context";
import { runImmediate } from "./transactions";

const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x51));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x52));
const VALID_SESSION_TOKEN = Buffer.alloc(32, 0x53);

let database: EnrollmentTestDatabase;
let appointmentId: string;
let tokenIndex: number;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager");
  appointmentId = insertAppointment(database);
  tokenIndex = 1;
});

afterEach(() => database.close());

function context(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return {
    ...database.context,
    tokenFactory: () => Buffer.alloc(32, tokenIndex++),
    ...overrides,
  };
}

function join(
  displayName: string,
  overrides: Partial<Parameters<typeof joinParticipant>[1]> = {},
  serviceContext = context(),
) {
  return joinParticipant(serviceContext, {
    publicId: PUBLIC_ID,
    displayName,
    identity: null,
    guestSessionToken: null,
    clientKey: "direct-client",
    ...overrides,
  }, TOKEN_DIGESTER, RATE_DIGESTER);
}

function expectAppError(operation: () => unknown, code: string): AppError {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({ code });
  return error as AppError;
}

describe("join participant rate limiting", () => {
  it("accepts ten valid direct-client joins and rejects the eleventh with retry metadata", () => {
    for (let index = 1; index <= JOIN_RATE_LIMIT; index += 1) {
      expect(join(`Guest ${index}`)).toMatchObject({ kind: "guest" });
    }

    const error = expectAppError(() => join("Guest 11"), "RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(3_600);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count)
      .toBe(JOIN_RATE_LIMIT);
    expect(database.connection.db.select().from(participants).all()).toHaveLength(10);
  });

  it("does not consume quota for malformed or duplicate names", () => {
    expectAppError(() => join("   "), "VALIDATION_FAILED");
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);

    join("Avery");
    expectAppError(() => join(" avery "), "NAME_TAKEN");
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
  });

  it("uses an unexpired guest-session hash instead of the request client bucket", () => {
    const sessionHash = TOKEN_DIGESTER.digestSessionToken(VALID_SESSION_TOKEN);
    database.connection.db.insert(guestSessions).values({
      tokenHash: sessionHash,
      createdAt: TEST_NOW,
      lastSeenAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();

    join("Session guest", {
      guestSessionToken: VALID_SESSION_TOKEN.toString("base64url"),
      clientKey: "198.51.100.7",
    });
    join("Client guest", { clientKey: "198.51.100.7" });

    const rows = database.connection.db.select().from(rateLimitWindows).all();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.key.toString("hex"))).size).toBe(2);
  });

  it("counts a pending co-organizer join without generating guest tokens", () => {
    insertManager(database, appointmentId, {
      userId: null,
      email: "manager@example.com",
    });
    const tokenFactory = vi.fn(() => {
      throw new Error("No guest tokens expected");
    });

    expect(join("Manager", {
      identity: { userId: MANAGER_USER_ID, email: "manager@example.com" },
    }, context({ tokenFactory }))).toMatchObject({ kind: "manager", revision: 2 });

    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
    expect(database.connection.db.select().from(appointmentManagers).get()?.userId)
      .toBe(MANAGER_USER_ID);
  });

  it("returns the participant cap before finalized state or a saturated bucket", () => {
    const creatorParticipantId = insertParticipant(database, appointmentId, "Guest 0");
    for (let index = 1; index < 200; index += 1) {
      insertParticipant(database, appointmentId, `Guest ${index}`);
    }
    finalizeAppointment(database, appointmentId, creatorParticipantId);
    runImmediate(database.context, (transactionContext) => {
      deleteExpiredRateLimitWindows(transactionContext, TEST_NOW);
      for (let count = 0; count < JOIN_RATE_LIMIT; count += 1) {
        consumeJoinRateLimit(transactionContext, {
          appointmentId,
          guestSessionHash: null,
          clientKey: "direct-client",
          now: TEST_NOW,
        }, RATE_DIGESTER);
      }
    });
    const tokenFactory = vi.fn(() => Buffer.alloc(32));

    expectAppError(() => join("Over cap", {}, context({ tokenFactory })), "PARTICIPANT_LIMIT_REACHED");
    expect(tokenFactory).not.toHaveBeenCalled();
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count)
      .toBe(JOIN_RATE_LIMIT);
  });

  it("does not consume quota for finalized state or token and domain failures", () => {
    const creatorParticipantId = insertParticipant(database, appointmentId, "Creator");
    finalizeAppointment(database, appointmentId, creatorParticipantId);
    expectAppError(() => join("Finalized"), "APPOINTMENT_FINALIZED");
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);

    database.connection.sqlite.exec("UPDATE appointments SET status = 'ACTIVE', final_option_id = NULL; DELETE FROM appointment_options");
    expectAppError(() => join("Bad token", {}, context({
      tokenFactory: () => Buffer.alloc(31),
    })), "INTERNAL_ERROR");
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);

    database.connection.sqlite.exec(`
      CREATE TRIGGER reject_rate_limited_participant
      BEFORE INSERT ON participants
      WHEN NEW.display_name = 'Write failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced participant write failure');
      END
    `);
    expectAppError(() => join("Write failure"), "INTERNAL_ERROR");
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
  });
});
