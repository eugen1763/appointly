import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
import type {
  CreateAppointmentInput,
  OptionInput,
} from "../contracts";
import { AppError, appErrorResponse } from "../http-errors";
import {
  createEnrollmentTestDatabase,
  insertUser,
  OWNER_USER_ID,
  TEST_NOW,
  type EnrollmentTestDatabase,
} from "./enrollment-test-support";
import {
  createAppointment,
  insertOwnerManagerAndParticipant,
  type CreateAppointmentCommandInput,
} from "./create-appointment";
import type { ServiceContext } from "./service-context";
import { runImmediate } from "./transactions";

const EXPECTED_PUBLIC_ID = "GRkZGRkZGRkZGRkZGRkZGRkZ";
const OWNER_EMAIL = " Owner@Example.COM ";

let database: EnrollmentTestDatabase;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner Account");
});

afterEach(() => {
  vi.restoreAllMocks();
  database.close();
});

function baseAppointment(
  overrides: Partial<CreateAppointmentInput> = {},
): CreateAppointmentInput {
  return {
    title: "  Plain-text planning <meeting>  ",
    description: "Keep\nplain text & spacing.",
    ownerDisplayName: "  Dr.   Owner  ",
    type: "DATE",
    optionLimit: 10,
    coOrganizerEmails: [],
    timeZone: "UTC",
    options: [{ kind: "DATE", startDate: "2030-01-02" }],
    ...overrides,
  };
}

function command(
  appointment: CreateAppointmentInput = baseAppointment(),
): CreateAppointmentCommandInput {
  return {
    ownerUserId: OWNER_USER_ID,
    ownerEmail: OWNER_EMAIL,
    appointment,
  };
}

function tableCount(
  table:
    | typeof appointments
    | typeof appointmentManagers
    | typeof participants
    | typeof appointmentOptions
    | typeof responses,
): number {
  return database.connection.db
    .select({ value: count() })
    .from(table)
    .get()!.value;
}

function expectEmptyGraph(): void {
  expect({
    appointments: tableCount(appointments),
    managers: tableCount(appointmentManagers),
    participants: tableCount(participants),
    options: tableCount(appointmentOptions),
    responses: tableCount(responses),
  }).toEqual({
    appointments: 0,
    managers: 0,
    participants: 0,
    options: 0,
    responses: 0,
  });
}

function expectAppError(
  operation: () => unknown,
  code: AppError["code"],
): AppError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`Expected ${code}`);
}

describe("insertOwnerManagerAndParticipant", () => {
  it("links one owner manager and participant inside its caller's immediate transaction", () => {
    const result = runImmediate(database.context, (transaction) => {
      const appointment = transaction.db.insert(appointments).values({
        publicId: "abcdefghijklmnopqrstuvwx",
        ownerUserId: OWNER_USER_ID,
        title: "Planning",
        description: null,
        type: "DATE",
        status: "ACTIVE",
        optionLimit: 10,
        finalOptionId: null,
        revision: 1,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      }).returning({ id: appointments.id }).get();

      const participantId = insertOwnerManagerAndParticipant(transaction, {
        appointmentId: appointment.id,
        ownerUserId: OWNER_USER_ID,
        ownerEmail: OWNER_EMAIL,
        ownerDisplayName: "  Dr.   Owner  ",
        now: TEST_NOW,
      });

      return { appointmentId: appointment.id, participantId };
    });

    expect(database.connection.db.select().from(appointmentManagers).all()).toEqual([
      expect.objectContaining({
        appointmentId: result.appointmentId,
        emailNormalized: "owner@example.com",
        userId: OWNER_USER_ID,
        role: "OWNER",
        createdAt: TEST_NOW,
      }),
    ]);
    expect(database.connection.db.select().from(participants).all()).toEqual([
      expect.objectContaining({
        id: result.participantId,
        appointmentId: result.appointmentId,
        userId: OWNER_USER_ID,
        displayName: "Dr. Owner",
        normalizedName: "dr. owner",
        editTokenHash: null,
        createdAt: TEST_NOW,
        updatedAt: TEST_NOW,
      }),
    ]);
  });
});

describe("createAppointment", () => {
  it("commits the complete graph with one timestamp, owner creators, and owner YES responses before publishing", () => {
    const publications: Array<{
      appointmentId: string;
      revision: number;
      committedAppointmentCount: number;
      inTransaction: boolean;
    }> = [];
    let clockCalls = 0;
    const context: ServiceContext = {
      ...database.context,
      clock: {
        now() {
          clockCalls += 1;
          return TEST_NOW;
        },
      },
      eventPublisher: {
        publish(appointmentId, revision) {
          publications.push({
            appointmentId,
            revision,
            committedAppointmentCount: tableCount(appointments),
            inTransaction: database.connection.sqlite.inTransaction,
          });
        },
      },
    };

    const result = createAppointment(context, command(baseAppointment({
      optionLimit: 4,
      coOrganizerEmails: [
        " Pending.ONE@Example.COM ",
        "pending.two@example.com",
      ],
      options: [
        { kind: "DATE", startDate: "2030-01-02" },
        { kind: "DATE", startDate: "2030-01-03" },
      ],
    })));

    expect(result).toEqual({ publicId: EXPECTED_PUBLIC_ID, revision: 1 });
    const appointment = database.connection.db.select().from(appointments).get()!;
    expect(appointment).toEqual(expect.objectContaining({
      publicId: EXPECTED_PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      title: "  Plain-text planning <meeting>  ",
      description: "Keep\nplain text & spacing.",
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 4,
      finalOptionId: null,
      revision: 1,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }));

    const managers = database.connection.db.select().from(appointmentManagers).all();
    expect(managers).toEqual([
      expect.objectContaining({
        appointmentId: appointment.id,
        emailNormalized: "owner@example.com",
        userId: OWNER_USER_ID,
        role: "OWNER",
        createdAt: TEST_NOW,
      }),
      expect.objectContaining({
        appointmentId: appointment.id,
        emailNormalized: "pending.one@example.com",
        userId: null,
        role: "COORGANIZER",
        createdAt: TEST_NOW,
      }),
      expect.objectContaining({
        appointmentId: appointment.id,
        emailNormalized: "pending.two@example.com",
        userId: null,
        role: "COORGANIZER",
        createdAt: TEST_NOW,
      }),
    ]);

    const ownerParticipant = database.connection.db.select().from(participants).get()!;
    const options = database.connection.db.select().from(appointmentOptions).all();
    expect(options).toHaveLength(2);
    expect(options.every((option) =>
      option.appointmentId === appointment.id
      && option.creatorParticipantId === ownerParticipant.id
      && option.createdAt === TEST_NOW
    )).toBe(true);
    expect(database.connection.db.select().from(responses).all()).toEqual(
      options.map((option) => ({
        appointmentId: appointment.id,
        participantId: ownerParticipant.id,
        optionId: option.id,
        value: "YES",
        updatedAt: TEST_NOW,
      })),
    );
    expect(clockCalls).toBe(1);
    expect(publications).toEqual([{
      appointmentId: appointment.id,
      revision: 1,
      committedAppointmentCount: 1,
      inTransaction: false,
    }]);
  });

  const storageCases: Array<{
    name: string;
    type: CreateAppointmentInput["type"];
    option: OptionInput;
    expected: {
      startDate: string | null;
      endDate: string | null;
      startAt: number | null;
      endAt: number | null;
      canonicalKey: string;
    };
  }> = [
    {
      name: "date",
      type: "DATE",
      option: { kind: "DATE", startDate: "2030-01-02" },
      expected: {
        startDate: "2030-01-02",
        endDate: null,
        startAt: null,
        endAt: null,
        canonicalKey: "D:2030-01-02",
      },
    },
    {
      name: "timed instant",
      type: "DATE_TIME",
      option: { kind: "DATE_TIME", startAt: "2030-01-02T03:04:05.006Z" },
      expected: {
        startDate: null,
        endDate: null,
        startAt: 1_893_553_445_006,
        endAt: null,
        canonicalKey: "T:1893553445006",
      },
    },
    {
      name: "date range",
      type: "DATE_RANGE",
      option: {
        kind: "DATE_RANGE",
        startDate: "2030-01-02",
        endDate: "2030-01-03",
      },
      expected: {
        startDate: "2030-01-02",
        endDate: "2030-01-03",
        startAt: null,
        endAt: null,
        canonicalKey: "DR:2030-01-02/2030-01-03",
      },
    },
    {
      name: "timed range",
      type: "DATE_TIME_RANGE",
      option: {
        kind: "DATE_TIME_RANGE",
        startAt: "2030-01-02T03:04:05.006Z",
        endAt: "2030-01-02T04:04:05.006Z",
      },
      expected: {
        startDate: null,
        endDate: null,
        startAt: 1_893_553_445_006,
        endAt: 1_893_557_045_006,
        canonicalKey: "TR:1893553445006/1893557045006",
      },
    },
  ];

  for (const storageCase of storageCases) {
    it(`stores the ${storageCase.name} option shape`, () => {
      createAppointment(database.context, command(baseAppointment({
        type: storageCase.type,
        options: [storageCase.option],
      })));

      expect(database.connection.db.select().from(appointmentOptions).get()).toEqual(
        expect.objectContaining(storageCase.expected),
      );
    });
  }

  it.each([
    {
      name: "date today",
      type: "DATE" as const,
      option: { kind: "DATE" as const, startDate: "2030-06-01" },
    },
    {
      name: "date range starting today",
      type: "DATE_RANGE" as const,
      option: {
        kind: "DATE_RANGE" as const,
        startDate: "2030-06-01",
        endDate: "2030-06-01",
      },
    },
    {
      name: "timed instant at exact now",
      type: "DATE_TIME" as const,
      option: {
        kind: "DATE_TIME" as const,
        startAt: "2030-06-01T04:00:00.000Z",
      },
    },
    {
      name: "timed range starting at exact now",
      type: "DATE_TIME_RANGE" as const,
      option: {
        kind: "DATE_TIME_RANGE" as const,
        startAt: "2030-06-01T04:00:00.000Z",
        endAt: "2030-06-01T04:00:00.001Z",
      },
    },
  ])("accepts $name at the creation boundary", ({ type, option }) => {
    createAppointment({
      ...database.context,
      clock: { now: () => 1_906_516_800_000 },
    }, command(baseAppointment({
      type,
      timeZone: "America/New_York",
      options: [option],
    })));

    expect(tableCount(appointmentOptions)).toBe(1);
  });

  it.each([
    {
      name: "date before today",
      type: "DATE" as const,
      option: { kind: "DATE" as const, startDate: "2030-05-31" },
      field: "options.0.startDate",
      message: "Start date must be today or later.",
    },
    {
      name: "date range starting before today",
      type: "DATE_RANGE" as const,
      option: {
        kind: "DATE_RANGE" as const,
        startDate: "2030-05-31",
        endDate: "2030-06-01",
      },
      field: "options.0.startDate",
      message: "Start date must be today or later.",
    },
    {
      name: "timed instant one millisecond before now",
      type: "DATE_TIME" as const,
      option: {
        kind: "DATE_TIME" as const,
        startAt: "2030-06-01T03:59:59.999Z",
      },
      field: "options.0.startAt",
      message: "Start date and time must be now or later.",
    },
    {
      name: "timed range starting one millisecond before now",
      type: "DATE_TIME_RANGE" as const,
      option: {
        kind: "DATE_TIME_RANGE" as const,
        startAt: "2030-06-01T03:59:59.999Z",
        endAt: "2030-06-01T04:00:00.001Z",
      },
      field: "options.0.startAt",
      message: "Start date and time must be now or later.",
    },
  ])(
    "rejects $name at its exact field before writes or publication",
    ({ type, option, field, message }) => {
      const publications: unknown[] = [];
      const error = expectAppError(() => createAppointment({
        ...database.context,
        clock: { now: () => 1_906_516_800_000 },
        eventPublisher: {
          publish(...values) {
            publications.push(values);
          },
        },
      }, command(baseAppointment({
        type,
        timeZone: "America/New_York",
        options: [option],
      }))), "VALIDATION_FAILED");

      expect(appErrorResponse(error).status).toBe(400);
      expect(error.fieldErrors).toEqual({ [field]: [message] });
      expectEmptyGraph();
      expect(publications).toEqual([]);
    },
  );

  it("uses the submitted zone when opposite zones have different dates", () => {
    const error = expectAppError(() => createAppointment({
      ...database.context,
      clock: { now: () => 1_893_578_399_999 },
    }, command(baseAppointment({
      timeZone: "Pacific/Kiritimati",
      options: [{ kind: "DATE", startDate: "2030-01-01" }],
    }))), "VALIDATION_FAILED");

    expect(error.fieldErrors).toEqual({
      "options.0.startDate": ["Start date must be today or later."],
    });
    expectEmptyGraph();
  });

  it("accepts the same date and instant in the opposite-date zone", () => {
    createAppointment({
      ...database.context,
      clock: { now: () => 1_893_578_399_999 },
    }, command(baseAppointment({
      timeZone: "Pacific/Honolulu",
      options: [{ kind: "DATE", startDate: "2030-01-01" }],
    })));

    expect(tableCount(appointmentOptions)).toBe(1);
  });

  it("keeps the prior local date until the submitted zone reaches midnight", () => {
    createAppointment({
      ...database.context,
      clock: { now: () => 1_906_516_799_999 },
    }, command(baseAppointment({
      timeZone: "America/New_York",
      options: [{ kind: "DATE", startDate: "2030-05-31" }],
    })));

    expect(tableCount(appointmentOptions)).toBe(1);
  });

  it("advances the submitted-zone date at local midnight", () => {
    const error = expectAppError(() => createAppointment({
      ...database.context,
      clock: { now: () => 1_906_516_800_000 },
    }, command(baseAppointment({
      timeZone: "America/New_York",
      options: [{ kind: "DATE", startDate: "2030-05-31" }],
    }))), "VALIDATION_FAILED");

    expect(error.fieldErrors).toEqual({
      "options.0.startDate": ["Start date must be today or later."],
    });
    expectEmptyGraph();
  });

  it("rejects an invalid IANA zone at timeZone before writes or publication", () => {
    const publications: unknown[] = [];
    const error = expectAppError(() => createAppointment({
      ...database.context,
      eventPublisher: {
        publish(...values) {
          publications.push(values);
        },
      },
    }, command(baseAppointment({
      timeZone: "Mars/Olympus_Mons",
    }))), "VALIDATION_FAILED");

    expect(appErrorResponse(error).status).toBe(400);
    expect(error.fieldErrors).toEqual({
      timeZone: ["Use a valid IANA time zone."],
    });
    expectEmptyGraph();
    expect(publications).toEqual([]);
  });

  it("keeps strict option syntax ahead of time-zone validation and the clock", () => {
    let clockCalls = 0;
    const error = expectAppError(() => createAppointment({
      ...database.context,
      clock: {
        now() {
          clockCalls += 1;
          return TEST_NOW;
        },
      },
    }, command(baseAppointment({
      timeZone: "Mars/Olympus_Mons",
      options: [{ kind: "DATE", startDate: "2030-1-02" }],
    }))), "VALIDATION_FAILED");

    expect(error.fieldErrors).toEqual({
      "options.0.startDate": ["Use YYYY-MM-DD with a real calendar date."],
    });
    expect(clockCalls).toBe(0);
    expectEmptyGraph();
  });

  it("uses one clock reading for exact-now validation and every stored timestamp", () => {
    let clockCalls = 0;
    const context: ServiceContext = {
      ...database.context,
      clock: {
        now() {
          clockCalls += 1;
          return clockCalls === 1
            ? 1_906_516_800_000
            : 1_906_516_800_001;
        },
      },
    };

    createAppointment(context, command(baseAppointment({
      type: "DATE_TIME",
      timeZone: "America/New_York",
      options: [{
        kind: "DATE_TIME",
        startAt: "2030-06-01T04:00:00.000Z",
      }],
    })));

    expect(clockCalls).toBe(1);
    expect(database.connection.db.select().from(appointments).get()).toEqual(
      expect.objectContaining({
        createdAt: 1_906_516_800_000,
        updatedAt: 1_906_516_800_000,
      }),
    );
    expect(database.connection.db.select().from(appointmentOptions).get()).toEqual(
      expect.objectContaining({ createdAt: 1_906_516_800_000 }),
    );
    expect(database.connection.db.select().from(responses).get()).toEqual(
      expect.objectContaining({ updatedAt: 1_906_516_800_000 }),
    );
  });

  it("maps a formatter runtime fault to a generic internal error", () => {
    const cause = new Error("formatter internals and submitted zone");
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "formatToParts",
    ).mockImplementation(() => {
      throw cause;
    });
    const publications: unknown[] = [];

    const error = expectAppError(() => createAppointment({
      ...database.context,
      eventPublisher: {
        publish(...values) {
          publications.push(values);
        },
      },
    }, command()), "INTERNAL_ERROR");

    expect(error.message).toBe("The appointment could not be created.");
    expect(error.fieldErrors).toBeUndefined();
    expect(error.cause).toBe(cause);
    expectEmptyGraph();
    expect(publications).toEqual([]);
  });

  it.each([
    ["non-integer", () => 1.5],
    ["not finite", () => Number.NaN],
    ["outside the formatter date range", () => 8_640_000_000_000_001],
  ])("maps an invalid %s clock value to an internal fault", (_name, now) => {
    const error = expectAppError(() => createAppointment({
      ...database.context,
      clock: { now },
    }, command()), "INTERNAL_ERROR");
    expect(error.cause).toBeInstanceOf(RangeError);
    expectEmptyGraph();
  });

  it("maps a throwing clock to an internal fault and retains its cause", () => {
    const cause = new Error("clock unavailable");
    const error = expectAppError(() => createAppointment({
      ...database.context,
      clock: {
        now() {
          throw cause;
        },
      },
    }, command()), "INTERNAL_ERROR");
    expect(error.cause).toBe(cause);
    expectEmptyGraph();
  });

  it("uses only the first 18 bytes of an exact 32-byte token and retries a public-ID collision", () => {
    database.connection.db.insert(appointments).values({
      publicId: EXPECTED_PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      title: "Existing",
      description: null,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 1,
      finalOptionId: null,
      revision: 1,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }).run();
    const tokens = [
      Buffer.concat([Buffer.alloc(18, 0x19), Buffer.alloc(14, 0xff)]),
      Buffer.concat([Buffer.alloc(18, 0x2a), Buffer.alloc(14, 0x00)]),
    ];
    let tokenCalls = 0;
    const result = createAppointment({
      ...database.context,
      tokenFactory: () => tokens[tokenCalls++]!,
    }, command());

    expect(result.publicId).toBe("KioqKioqKioqKioqKioqKioq");
    expect(result.publicId).toHaveLength(24);
    expect(result.publicId).toMatch(/^[A-Za-z0-9_-]{24}$/u);
    expect(tokenCalls).toBe(2);
    expect(tableCount(appointments)).toBe(2);
  });

  it.each([
    ["short", Buffer.alloc(31)],
    ["long", Buffer.alloc(33)],
  ])("maps a %s injected token to an internal fault before rows persist", (_name, token) => {
    const error = expectAppError(() => createAppointment({
      ...database.context,
      tokenFactory: () => token,
    }, command()), "INTERNAL_ERROR");
    expect(error.cause).toBeInstanceOf(RangeError);
    expectEmptyGraph();
  });

  it("maps a throwing token factory to an internal fault and retains its cause", () => {
    const cause = new Error("entropy unavailable");
    const error = expectAppError(() => createAppointment({
      ...database.context,
      tokenFactory() {
        throw cause;
      },
    }, command()), "INTERNAL_ERROR");
    expect(error.cause).toBe(cause);
    expectEmptyGraph();
  });

  it("bounds public-ID collision retries and leaves no new graph", () => {
    database.connection.db.insert(appointments).values({
      publicId: EXPECTED_PUBLIC_ID,
      ownerUserId: OWNER_USER_ID,
      title: "Existing",
      description: null,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 1,
      finalOptionId: null,
      revision: 1,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }).run();
    let tokenCalls = 0;

    const error = expectAppError(() => createAppointment({
      ...database.context,
      tokenFactory() {
        tokenCalls += 1;
        return Buffer.alloc(32, 0x19);
      },
    }, command()), "INTERNAL_ERROR");
    expect(error.cause).toBeInstanceOf(Error);

    expect(tokenCalls).toBeGreaterThan(1);
    expect(tokenCalls).toBeLessThanOrEqual(16);
    expect(tableCount(appointments)).toBe(1);
    expect(tableCount(appointmentManagers)).toBe(0);
    expect(tableCount(participants)).toBe(0);
    expect(tableCount(appointmentOptions)).toBe(0);
    expect(tableCount(responses)).toBe(0);
  });

  it("rejects a whitespace-only title before writing", () => {
    expectAppError(() => createAppointment(database.context, command(baseAppointment({
      title: " \t\n\u00a0\u2003 ",
    }))), "VALIDATION_FAILED");
    expectEmptyGraph();
  });

  it("rejects duplicate canonical options before writing", () => {
    expectAppError(() => createAppointment(database.context, command(baseAppointment({
      options: [
        { kind: "DATE", startDate: "2030-01-02" },
        { kind: "DATE", startDate: "2030-01-02" },
      ],
    }))), "DUPLICATE_OPTION");
    expectEmptyGraph();
  });

  it.each([
    {
      name: "owner email repeated as a co-organizer",
      emails: ["OWNER@example.com"],
    },
    {
      name: "duplicate normalized co-organizer emails",
      emails: [" Person@Example.com ", "person@example.COM"],
    },
  ])("rejects $name before writing", ({ emails }) => {
    expectAppError(() => createAppointment(database.context, command(baseAppointment({
      coOrganizerEmails: emails,
    }))), "MANAGER_ALREADY_EXISTS");
    expectEmptyGraph();
  });

  it("rejects an initial option count over the chosen limit", () => {
    expectAppError(() => createAppointment(database.context, command(baseAppointment({
      optionLimit: 1,
      options: [
        { kind: "DATE", startDate: "2030-01-02" },
        { kind: "DATE", startDate: "2030-01-03" },
      ],
    }))), "OPTION_LIMIT_REACHED");
    expectEmptyGraph();
  });

  it("rejects a mismatched option kind", () => {
    expectAppError(() => createAppointment(database.context, command(baseAppointment({
      type: "DATE",
      options: [{ kind: "DATE_TIME", startAt: "2030-01-02T03:04:05.006Z" }],
    }))), "VALIDATION_FAILED");
    expectEmptyGraph();
  });

  const invalidOptionCases: Array<{
    name: string;
    type: CreateAppointmentInput["type"];
    option: OptionInput;
    field: string;
    message: string;
  }> = [
    {
      name: "non-exact date syntax",
      type: "DATE",
      option: { kind: "DATE", startDate: "2030-1-02" },
      field: "options.0.startDate",
      message: "Use YYYY-MM-DD with a real calendar date.",
    },
    {
      name: "impossible start date",
      type: "DATE",
      option: { kind: "DATE", startDate: "2030-02-29" },
      field: "options.0.startDate",
      message: "Use YYYY-MM-DD with a real calendar date.",
    },
    {
      name: "impossible end date",
      type: "DATE_RANGE",
      option: {
        kind: "DATE_RANGE",
        startDate: "2030-01-02",
        endDate: "2030-04-31",
      },
      field: "options.0.endDate",
      message: "Use YYYY-MM-DD with a real calendar date.",
    },
    {
      name: "reversed date range",
      type: "DATE_RANGE",
      option: {
        kind: "DATE_RANGE",
        startDate: "2030-01-03",
        endDate: "2030-01-02",
      },
      field: "options.0.endDate",
      message: "End date must be on or after start date.",
    },
    {
      name: "non-canonical timed start",
      type: "DATE_TIME",
      option: {
        kind: "DATE_TIME",
        startAt: "2030-01-02T03:04:05.006+00:00",
      },
      field: "options.0.startAt",
      message:
        "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
    },
    {
      name: "impossible timed end",
      type: "DATE_TIME_RANGE",
      option: {
        kind: "DATE_TIME_RANGE",
        startAt: "2030-01-02T03:04:05.006Z",
        endAt: "2030-02-29T03:04:05.006Z",
      },
      field: "options.0.endAt",
      message:
        "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
    },
    {
      name: "non-increasing timed range",
      type: "DATE_TIME_RANGE",
      option: {
        kind: "DATE_TIME_RANGE",
        startAt: "2030-01-02T03:04:05.006Z",
        endAt: "2030-01-02T03:04:05.006Z",
      },
      field: "options.0.endAt",
      message: "End date and time must be after start date and time.",
    },
  ];

  it.each(invalidOptionCases)(
    "rejects $name at its exact option path before writes or publication",
    ({ type, option, field, message }) => {
      const publications: unknown[] = [];
      const error = expectAppError(() => createAppointment({
        ...database.context,
        eventPublisher: {
          publish(...values) {
            publications.push(values);
          },
        },
      }, command(baseAppointment({
        type,
        options: [option],
      }))), "VALIDATION_FAILED");

      expect(appErrorResponse(error).status).toBe(400);
      expect(error.fieldErrors).toEqual({ [field]: [message] });
      expectEmptyGraph();
      expect(publications).toEqual([]);
    },
  );

  it("rolls back every prior row when a late SQLite insert fails", () => {
    database.connection.sqlite.exec(`
      CREATE TRIGGER fail_initial_response
      BEFORE INSERT ON responses
      BEGIN
        SELECT RAISE(ABORT, 'forced response failure');
      END
    `);

    const error = expectAppError(
      () => createAppointment(database.context, command()),
      "INTERNAL_ERROR",
    );
    expect(error.cause).toBeInstanceOf(Error);
    expect(String(error.cause)).toContain("forced response failure");
    expectEmptyGraph();
  });

  it("does not publish when creation fails", () => {
    const publications: unknown[] = [];
    expectAppError(() => createAppointment({
      ...database.context,
      eventPublisher: {
        publish(...values) {
          publications.push(values);
        },
      },
    }, command(baseAppointment({
      options: [
        { kind: "DATE", startDate: "2030-01-02" },
        { kind: "DATE", startDate: "2030-01-02" },
      ],
    }))), "DUPLICATE_OPTION");
    expect(publications).toEqual([]);
  });

  it("returns committed success and keeps the graph when event publication fails", () => {
    const cause = new Error("publisher unavailable");
    const result = createAppointment({
      ...database.context,
      eventPublisher: {
        publish() {
          throw cause;
        },
      },
    }, command());

    expect(result).toEqual({ publicId: EXPECTED_PUBLIC_ID, revision: 1 });
    expect(tableCount(appointments)).toBe(1);
    expect(tableCount(appointmentManagers)).toBe(1);
    expect(tableCount(participants)).toBe(1);
    expect(tableCount(appointmentOptions)).toBe(1);
    expect(tableCount(responses)).toBe(1);
  });

  it("keeps all created rows tied to the new appointment", () => {
    const result = createAppointment(database.context, command());
    const appointment = database.connection.db.select().from(appointments)
      .where(eq(appointments.publicId, result.publicId))
      .get()!;
    expect(database.connection.db.select().from(appointmentManagers).get()!.appointmentId)
      .toBe(appointment.id);
    expect(database.connection.db.select().from(participants).get()!.appointmentId)
      .toBe(appointment.id);
    expect(database.connection.db.select().from(appointmentOptions).get()!.appointmentId)
      .toBe(appointment.id);
    expect(database.connection.db.select().from(responses).get()!.appointmentId)
      .toBe(appointment.id);
  });
});
