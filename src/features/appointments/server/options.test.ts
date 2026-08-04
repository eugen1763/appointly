import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { and, eq } from "drizzle-orm";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  rateLimitWindows,
  responses,
} from "../../../db/schema";
import {
  createGuestTokenDigester,
  createRateKeyDigester,
} from "../../../lib/security";
import type { OptionInput } from "../contracts";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertAppointment,
  insertManager,
  insertParticipant,
  insertUser,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import { addOption, type AddOptionInput } from "./options";
import { PUBLIC_WRITE_RATE_LIMIT } from "./rate-limit";

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000003";
const VISITOR_USER_ID = "00000000-0000-4000-8000-000000000004";
const OTHER_PUBLIC_ID = "zyxwvutsrqponmlkjihgfedc";
const SESSION_TOKEN = Buffer.alloc(32, 0x35);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x45));
const RATE_DIGESTER = createRateKeyDigester(Buffer.alloc(32, 0x55));
const SESSION_TOKEN_VALUE = SESSION_TOKEN.toString("base64url");

let publish: Mock;
let database: EnrollmentTestDatabase;
let appointmentId: string;
let guestParticipantId: string;

beforeEach(() => {
  publish = vi.fn();
  database = createEnrollmentTestDatabase({ publish });
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
  guestParticipantId = insertParticipant(database, appointmentId, "Guest");
  grantGuestAccess(guestParticipantId);
});

afterEach(() => database.close());

function grantGuestAccess(
  participantId: string,
  token: Buffer = SESSION_TOKEN,
): void {
  const tokenHash = TOKEN_DIGESTER.digestSessionToken(token);
  database.connection.db.insert(guestSessions).values({
    tokenHash,
    createdAt: TEST_NOW - 1_000,
    expiresAt: TEST_NOW + 60_000,
    lastSeenAt: TEST_NOW - 1_000,
  }).onConflictDoNothing().run();
  database.connection.db.insert(guestSessionAccess).values({
    sessionTokenHash: tokenHash,
    participantId,
    createdAt: TEST_NOW,
  }).run();
}

function suggest(
  option: OptionInput = { kind: "DATE", startDate: "2030-01-15" },
  overrides: Partial<AddOptionInput> = {},
) {
  return addOption(database.context, {
    publicId: PUBLIC_ID,
    participantId: guestParticipantId,
    timeZone: "UTC",
    option,
    identity: null,
    guestSessionToken: SESSION_TOKEN_VALUE,
    ...overrides,
  }, TOKEN_DIGESTER, RATE_DIGESTER);
}

function expectAppError(operation: () => unknown, code: string): AppError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code });
    return error as AppError;
  }
  throw new Error(`Expected ${code}`);
}

function optionRows() {
  return database.connection.db.select().from(appointmentOptions).all();
}

function responseRows() {
  return database.connection.db.select().from(responses).all();
}

describe("addOption", () => {
  it("commits one guest-owned option, automatic YES, revision, and publication atomically", () => {
    const observations: Array<{
      appointmentId: string;
      revision: number;
      optionCount: number;
      yesCount: number;
      storedRevision: number | undefined;
    }> = [];
    publish.mockImplementation((publishedAppointmentId: string, revision: number) => {
      observations.push({
        appointmentId: publishedAppointmentId,
        revision,
        optionCount: optionRows().length,
        yesCount: responseRows().filter((row) => row.value === "YES").length,
        storedRevision: database.connection.db.select({ revision: appointments.revision })
          .from(appointments).where(eq(appointments.id, appointmentId)).get()?.revision,
      });
    });

    const result = suggest();

    expect(result.revision).toBe(2);
    expect(result.optionId).toEqual(expect.any(String));
    expect(optionRows()).toEqual([
      expect.objectContaining({
        id: result.optionId,
        appointmentId,
        creatorParticipantId: guestParticipantId,
        canonicalKey: "D:2030-01-15",
        createdAt: TEST_NOW,
      }),
    ]);
    expect(responseRows()).toEqual([{
      appointmentId,
      participantId: guestParticipantId,
      optionId: result.optionId,
      value: "YES",
      updatedAt: TEST_NOW,
    }]);
    expect(observations).toEqual([{
      appointmentId,
      revision: 2,
      optionCount: 1,
      yesCount: 1,
      storedRevision: 2,
    }]);
  });

  it("derives ownership for a bound manager participant and after co-organizer removal", () => {
    insertUser(database, AUTH_USER_ID, "manager@example.com", "Manager");
    const participantId = insertParticipant(
      database,
      appointmentId,
      "Manager",
      AUTH_USER_ID,
    );
    insertManager(database, appointmentId, {
      userId: AUTH_USER_ID,
      email: "manager@example.com",
      role: "COORGANIZER",
    });

    const first = suggest({ kind: "DATE", startDate: "2030-01-16" }, {
      participantId,
      identity: { userId: AUTH_USER_ID },
      guestSessionToken: null,
    });
    database.connection.db.delete(appointmentManagers).where(and(
      eq(appointmentManagers.appointmentId, appointmentId),
      eq(appointmentManagers.userId, AUTH_USER_ID),
    )).run();
    const second = suggest({ kind: "DATE", startDate: "2030-01-17" }, {
      participantId,
      identity: { userId: AUTH_USER_ID },
      guestSessionToken: null,
    });

    expect([first.revision, second.revision]).toEqual([2, 3]);
    expect(optionRows().map((row) => row.creatorParticipantId)).toEqual([
      participantId,
      participantId,
    ]);
    expect(responseRows().map((row) => [row.participantId, row.value])).toEqual([
      [participantId, "YES"],
      [participantId, "YES"],
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("lets a normal guest and an unrelated signed-in visitor use guest access", () => {
    insertUser(database, VISITOR_USER_ID, "visitor@example.com", "Visitor");

    expect(suggest({ kind: "DATE", startDate: "2030-01-18" }).revision).toBe(2);
    expect(suggest({ kind: "DATE", startDate: "2030-01-19" }, {
      identity: { userId: VISITOR_USER_ID },
    }).revision).toBe(3);

    expect(optionRows().map((row) => row.creatorParticipantId)).toEqual([
      guestParticipantId,
      guestParticipantId,
    ]);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(2);
  });

  it("returns the same forbidden result for participant mismatch and cross-appointment access", () => {
    const otherParticipantId = insertParticipant(database, appointmentId, "Other guest");
    expectAppError(() => suggest(undefined, {
      participantId: otherParticipantId,
    }), "FORBIDDEN");

    const otherAppointmentId = insertAppointment(
      database,
      OWNER_USER_ID,
      OTHER_PUBLIC_ID,
    );
    const foreignParticipantId = insertParticipant(
      database,
      otherAppointmentId,
      "Foreign guest",
    );
    expectAppError(() => suggest(undefined, {
      publicId: OTHER_PUBLIC_ID,
      participantId: foreignParticipantId,
    }), "FORBIDDEN");

    expect(optionRows()).toEqual([]);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    {
      type: "DATE" as const,
      option: { kind: "DATE" as const, startDate: "2030-02-01" },
      expected: {
        startDate: "2030-02-01",
        endDate: null,
        startAt: null,
        endAt: null,
        canonicalKey: "D:2030-02-01",
      },
    },
    {
      type: "DATE_TIME" as const,
      option: { kind: "DATE_TIME" as const, startAt: "2030-02-01T12:30:00.000Z" },
      expected: {
        startDate: null,
        endDate: null,
        startAt: Date.parse("2030-02-01T12:30:00.000Z"),
        endAt: null,
        canonicalKey: `T:${Date.parse("2030-02-01T12:30:00.000Z")}`,
      },
    },
    {
      type: "DATE_RANGE" as const,
      option: {
        kind: "DATE_RANGE" as const,
        startDate: "2030-02-01",
        endDate: "2030-02-03",
      },
      expected: {
        startDate: "2030-02-01",
        endDate: "2030-02-03",
        startAt: null,
        endAt: null,
        canonicalKey: "DR:2030-02-01/2030-02-03",
      },
    },
    {
      type: "DATE_TIME_RANGE" as const,
      option: {
        kind: "DATE_TIME_RANGE" as const,
        startAt: "2030-02-01T12:30:00.000Z",
        endAt: "2030-02-01T13:30:00.000Z",
      },
      expected: {
        startDate: null,
        endDate: null,
        startAt: Date.parse("2030-02-01T12:30:00.000Z"),
        endAt: Date.parse("2030-02-01T13:30:00.000Z"),
        canonicalKey: `TR:${Date.parse("2030-02-01T12:30:00.000Z")}/${Date.parse("2030-02-01T13:30:00.000Z")}`,
      },
    },
  ])("stores a valid $type option and its YES response", ({ type, option, expected }) => {
    database.connection.db.update(appointments).set({ type })
      .where(eq(appointments.id, appointmentId)).run();

    const result = suggest(option);

    expect(optionRows()).toEqual([
      expect.objectContaining({
        id: result.optionId,
        creatorParticipantId: guestParticipantId,
        ...expected,
      }),
    ]);
    expect(responseRows()).toEqual([
      expect.objectContaining({
        optionId: result.optionId,
        participantId: guestParticipantId,
        value: "YES",
      }),
    ]);
  });

  it("maps kind, field, and IANA time-zone failures to stable validation errors", () => {
    const kindError = expectAppError(() => suggest({
      kind: "DATE_TIME",
      startAt: "2030-02-01T12:30:00.000Z",
    }), "VALIDATION_FAILED");
    expect(kindError.fieldErrors).toEqual({
      "option.kind": ["Option kind must match appointment type."],
    });

    const fieldError = expectAppError(() => suggest({
      kind: "DATE",
      startDate: "2030-02-31",
    }), "VALIDATION_FAILED");
    expect(fieldError.fieldErrors).toEqual({
      "option.startDate": ["Use YYYY-MM-DD with a real calendar date."],
    });

    const zoneError = expectAppError(() => suggest(undefined, {
      timeZone: "Mars/Olympus_Mons",
    }), "VALIDATION_FAILED");
    expect(zoneError.fieldErrors).toEqual({
      timeZone: ["Use a valid IANA time zone."],
    });

    expect(optionRows()).toEqual([]);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
  });

  it("accepts starts at the current local date or instant and rejects past starts", () => {
    const currentDate = new Date(TEST_NOW).toISOString().slice(0, 10);
    const previousDate = new Date(TEST_NOW - 86_400_000).toISOString().slice(0, 10);
    expect(suggest({ kind: "DATE", startDate: currentDate }).revision).toBe(2);

    const pastDate = expectAppError(() => suggest({
      kind: "DATE",
      startDate: previousDate,
    }), "VALIDATION_FAILED");
    expect(pastDate.fieldErrors).toEqual({
      "option.startDate": ["Start date must be today or later."],
    });

    database.connection.db.update(appointments).set({ type: "DATE_TIME" })
      .where(eq(appointments.id, appointmentId)).run();
    expect(suggest({
      kind: "DATE_TIME",
      startAt: new Date(TEST_NOW).toISOString(),
    }).revision).toBe(3);
    const pastInstant = expectAppError(() => suggest({
      kind: "DATE_TIME",
      startAt: new Date(TEST_NOW - 1).toISOString(),
    }), "VALIDATION_FAILED");
    expect(pastInstant.fieldErrors).toEqual({
      "option.startAt": ["Start date and time must be now or later."],
    });

    expect(optionRows()).toHaveLength(2);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(2);
  });

  it("rejects duplicate canonical keys without quota, revision, or publication", () => {
    expect(suggest().revision).toBe(2);

    expectAppError(() => suggest(), "DUPLICATE_OPTION");

    expect(optionRows()).toHaveLength(1);
    expect(responseRows()).toHaveLength(1);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(2);
    expect(database.connection.db.select().from(rateLimitWindows).get()?.count).toBe(1);
    expect(publish).toHaveBeenCalledOnce();
  });

  it("rejects a full option limit before consuming quota", () => {
    database.connection.db.insert(appointmentOptions).values({
      appointmentId,
      creatorParticipantId: guestParticipantId,
      startDate: "2030-01-01",
      canonicalKey: "D:2030-01-01",
      createdAt: TEST_NOW,
    }).run();
    database.connection.db.update(appointments).set({ optionLimit: 1 })
      .where(eq(appointments.id, appointmentId)).run();

    expectAppError(() => suggest(), "OPTION_LIMIT_REACHED");

    expect(optionRows()).toHaveLength(1);
    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(1);
  });

  it("returns finalized state after authorization and before option validation or quota", () => {
    const finalOption = database.connection.db.insert(appointmentOptions).values({
      appointmentId,
      creatorParticipantId: guestParticipantId,
      startDate: "2030-01-01",
      canonicalKey: "D:2030-01-01",
      createdAt: TEST_NOW,
    }).returning({ id: appointmentOptions.id }).get();
    database.connection.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: finalOption.id,
    }).where(eq(appointments.id, appointmentId)).run();

    expectAppError(() => suggest({
      kind: "DATE_TIME",
      startAt: "invalid",
    }), "APPOINTMENT_FINALIZED");
    expectAppError(() => suggest(undefined, {
      participantId: insertParticipant(database, appointmentId, "Mismatch"),
    }), "FORBIDDEN");

    expect(database.connection.db.select().from(rateLimitWindows).all()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it("checks all authorization and domain failures before the rate-limit bucket", () => {
    database.connection.db.insert(appointmentOptions).values({
      appointmentId,
      creatorParticipantId: guestParticipantId,
      startDate: "2030-01-15",
      canonicalKey: "D:2030-01-15",
      createdAt: TEST_NOW,
    }).run();
    database.connection.db.insert(rateLimitWindows).values({
      key: RATE_DIGESTER.digestRateKey(
        "public-write",
        appointmentId,
        "participant",
        guestParticipantId,
      ),
      count: PUBLIC_WRITE_RATE_LIMIT,
      windowStartedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();

    expectAppError(() => suggest(undefined, {
      guestSessionToken: null,
    }), "FORBIDDEN");
    expectAppError(() => suggest(), "DUPLICATE_OPTION");
    const limited = expectAppError(() => suggest({
      kind: "DATE",
      startDate: "2030-01-16",
    }), "RATE_LIMITED");

    expect(limited.retryAfterSeconds).toBe(60);
    expect(optionRows()).toHaveLength(1);
    expect(responseRows()).toEqual([]);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back quota, option, YES, and revision when an atomic write fails", () => {
    const key = RATE_DIGESTER.digestRateKey(
      "public-write",
      appointmentId,
      "participant",
      guestParticipantId,
    );
    database.connection.db.insert(rateLimitWindows).values({
      key,
      count: 3,
      windowStartedAt: TEST_NOW,
      expiresAt: TEST_NOW + 60_000,
    }).run();
    database.connection.sqlite.exec(`
      CREATE TRIGGER fail_suggestion_response
      BEFORE INSERT ON responses
      BEGIN
        SELECT RAISE(ABORT, 'forced response failure');
      END
    `);

    const error = expectAppError(() => suggest(), "INTERNAL_ERROR");

    expect(error.message).toBe("Could not add the option.");
    expect(optionRows()).toEqual([]);
    expect(responseRows()).toEqual([]);
    expect(database.connection.db.select().from(rateLimitWindows)
      .where(eq(rateLimitWindows.key, key)).get()?.count).toBe(3);
    expect(database.connection.db.select().from(appointments).get()?.revision).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });
});
