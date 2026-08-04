import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { user } from "../../../db/auth-schema";
import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
  responses,
} from "../../../db/schema";
import {
  createEnrollmentTestDatabase,
  type EnrollmentTestDatabase,
  OWNER_USER_ID,
  PUBLIC_ID,
  TEST_NOW,
} from "./enrollment-test-support";
import { getPublicAppointment } from "./snapshot";

const APPOINTMENT_ID = "00000000-0000-4000-8000-000000000010";
const EARLY_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000103";
const TIED_PARTICIPANT_A_ID = "00000000-0000-4000-8000-000000000101";
const TIED_PARTICIPANT_B_ID = "00000000-0000-4000-8000-000000000102";
const FIRST_OPTION_ID = "00000000-0000-4000-8000-000000000201";
const SECOND_OPTION_ID = "00000000-0000-4000-8000-000000000202";
const LAST_OPTION_ID = "00000000-0000-4000-8000-000000000203";

let database: EnrollmentTestDatabase;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  database.connection.db.insert(user).values({
    id: OWNER_USER_ID,
    name: "Private owner",
    email: "manager-secret@example.com",
    emailVerified: true,
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
  }).run();
});

afterEach(() => database.close());

function insertAppointment(type: "DATE" | "DATE_TIME" | "DATE_RANGE" | "DATE_TIME_RANGE"): void {
  database.connection.db.insert(appointments).values({
    id: APPOINTMENT_ID,
    publicId: PUBLIC_ID,
    ownerUserId: OWNER_USER_ID,
    title: "Release planning",
    description: "Choose a time for the release review.",
    type,
    status: "ACTIVE",
    optionLimit: 7,
    finalOptionId: null,
    revision: 4,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  }).run();
  database.connection.db.insert(appointmentManagers).values({
    appointmentId: APPOINTMENT_ID,
    emailNormalized: "manager-secret@example.com",
    userId: OWNER_USER_ID,
    role: "OWNER",
    createdAt: TEST_NOW,
  }).run();
  database.connection.db.insert(participants).values([
    {
      id: TIED_PARTICIPANT_B_ID,
      appointmentId: APPOINTMENT_ID,
      displayName: "Zoë Long Participant Name",
      normalizedName: "zoë long participant name",
      editTokenHash: Buffer.alloc(32, 0x42),
      createdAt: 200,
      updatedAt: 200,
    },
    {
      id: EARLY_PARTICIPANT_ID,
      appointmentId: APPOINTMENT_ID,
      displayName: "First guest",
      normalizedName: "first guest",
      createdAt: 100,
      updatedAt: 100,
    },
    {
      id: TIED_PARTICIPANT_A_ID,
      appointmentId: APPOINTMENT_ID,
      displayName: "Ada Guest",
      normalizedName: "ada guest",
      createdAt: 200,
      updatedAt: 200,
    },
  ]).run();
}

function optionValues(
  type: "DATE" | "DATE_TIME" | "DATE_RANGE" | "DATE_TIME_RANGE",
  start: string | number,
  end?: string | number,
) {
  switch (type) {
    case "DATE":
      return { startDate: String(start), canonicalKey: `D:${String(start)}` };
    case "DATE_TIME":
      return { startAt: Number(start), canonicalKey: `T:${String(start)}` };
    case "DATE_RANGE":
      return {
        startDate: String(start),
        endDate: String(end),
        canonicalKey: `DR:${String(start)}/${String(end)}`,
      };
    case "DATE_TIME_RANGE":
      return {
        startAt: Number(start),
        endAt: Number(end),
        canonicalKey: `TR:${String(start)}/${String(end)}`,
      };
  }
}

function insertOption(
  id: string,
  type: "DATE" | "DATE_TIME" | "DATE_RANGE" | "DATE_TIME_RANGE",
  start: string | number,
  createdAt: number,
  end?: string | number,
): void {
  database.connection.db.insert(appointmentOptions).values({
    id,
    appointmentId: APPOINTMENT_ID,
    creatorParticipantId: EARLY_PARTICIPANT_ID,
    createdAt,
    ...optionValues(type, start, end),
  }).run();
}

describe("getPublicAppointment", () => {
  it.each([
    {
      type: "DATE" as const,
      firstStart: "2032-04-03",
      firstEnd: undefined,
      middleStart: "2032-04-04",
      middleEnd: undefined,
      lastStart: "2032-04-05",
      lastEnd: undefined,
      expectedFirst: { kind: "DATE", startDate: "2032-04-03" },
    },
    {
      type: "DATE_TIME" as const,
      firstStart: 1_965_000_000_000,
      firstEnd: undefined,
      middleStart: 1_965_003_600_000,
      middleEnd: undefined,
      lastStart: 1_965_007_200_000,
      lastEnd: undefined,
      expectedFirst: { kind: "DATE_TIME", startAt: 1_965_000_000_000 },
    },
    {
      type: "DATE_RANGE" as const,
      firstStart: "2032-04-03",
      firstEnd: "2032-04-05",
      middleStart: "2032-04-04",
      middleEnd: "2032-04-06",
      lastStart: "2032-04-05",
      lastEnd: "2032-04-07",
      expectedFirst: { kind: "DATE_RANGE", startDate: "2032-04-03", endDate: "2032-04-05" },
    },
    {
      type: "DATE_TIME_RANGE" as const,
      firstStart: 1_965_000_000_000,
      firstEnd: 1_965_001_800_000,
      middleStart: 1_965_003_600_000,
      middleEnd: 1_965_005_400_000,
      lastStart: 1_965_007_200_000,
      lastEnd: 1_965_009_000_000,
      expectedFirst: { kind: "DATE_TIME_RANGE", startAt: 1_965_000_000_000, endAt: 1_965_001_800_000 },
    },
  ])("orders $type options by their type-specific start", ({
    type,
    firstStart,
    firstEnd,
    middleStart,
    middleEnd,
    lastStart,
    lastEnd,
    expectedFirst,
  }) => {
    insertAppointment(type);
    insertOption(LAST_OPTION_ID, type, lastStart, 100, lastEnd);
    insertOption(SECOND_OPTION_ID, type, middleStart, 300, middleEnd);
    insertOption(FIRST_OPTION_ID, type, firstStart, 200, firstEnd);

    const result = getPublicAppointment(database.context, PUBLIC_ID);

    expect(result?.options.map(({ id }) => id)).toEqual([
      FIRST_OPTION_ID,
      SECOND_OPTION_ID,
      LAST_OPTION_ID,
    ]);
    expect(result?.options[0]).toMatchObject(expectedFirst);
  });

  it("breaks equal range starts by created time and then ID", () => {
    insertAppointment("DATE_RANGE");
    insertOption(SECOND_OPTION_ID, "DATE_RANGE", "2032-04-03", 200, "2032-04-05");
    insertOption(FIRST_OPTION_ID, "DATE_RANGE", "2032-04-03", 200, "2032-04-04");
    insertOption(LAST_OPTION_ID, "DATE_RANGE", "2032-04-03", 100, "2032-04-06");

    expect(getPublicAppointment(database.context, PUBLIC_ID)?.options.map(({ id }) => id)).toEqual([
      LAST_OPTION_ID,
      FIRST_OPTION_ID,
      SECOND_OPTION_ID,
    ]);
  });

  it("returns only the approved public projection with stable participants and responses", () => {
    insertAppointment("DATE_TIME");
    insertOption(FIRST_OPTION_ID, "DATE_TIME", 1_965_000_000_000, 100);
    insertOption(LAST_OPTION_ID, "DATE_TIME", 1_965_003_600_000, 200);
    database.connection.db.insert(responses).values([
      {
        appointmentId: APPOINTMENT_ID,
        participantId: TIED_PARTICIPANT_B_ID,
        optionId: FIRST_OPTION_ID,
        value: "YES",
        updatedAt: 300,
      },
      {
        appointmentId: APPOINTMENT_ID,
        participantId: EARLY_PARTICIPANT_ID,
        optionId: FIRST_OPTION_ID,
        value: "NO",
        updatedAt: 300,
      },
      {
        appointmentId: APPOINTMENT_ID,
        participantId: TIED_PARTICIPANT_A_ID,
        optionId: LAST_OPTION_ID,
        value: "YES",
        updatedAt: 300,
      },
    ]).run();
    database.connection.db.insert(guestSessions).values({
      tokenHash: Buffer.alloc(32, 0x32),
      createdAt: 1,
      expiresAt: 10,
      lastSeenAt: 1,
    }).run();
    database.connection.db.insert(guestSessionAccess).values({
      sessionTokenHash: Buffer.alloc(32, 0x32),
      participantId: EARLY_PARTICIPANT_ID,
      createdAt: 1,
    }).run();
    database.connection.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: LAST_OPTION_ID,
    }).run();

    const result = getPublicAppointment(database.context, PUBLIC_ID);

    expect(result).toEqual({
      appointment: {
        publicId: PUBLIC_ID,
        title: "Release planning",
        description: "Choose a time for the release review.",
        type: "DATE_TIME",
        status: "FINALIZED",
        optionLimit: 7,
        finalOptionId: LAST_OPTION_ID,
        revision: 4,
      },
      participants: [
        { id: EARLY_PARTICIPANT_ID, displayName: "First guest" },
        { id: TIED_PARTICIPANT_A_ID, displayName: "Ada Guest" },
        { id: TIED_PARTICIPANT_B_ID, displayName: "Zoë Long Participant Name" },
      ],
      options: [
        {
          id: FIRST_OPTION_ID,
          kind: "DATE_TIME",
          startAt: 1_965_000_000_000,
          responses: [
            { participantId: EARLY_PARTICIPANT_ID, value: "NO" },
            { participantId: TIED_PARTICIPANT_B_ID, value: "YES" },
          ],
        },
        {
          id: LAST_OPTION_ID,
          kind: "DATE_TIME",
          startAt: 1_965_003_600_000,
          responses: [
            { participantId: TIED_PARTICIPANT_A_ID, value: "YES" },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("manager-secret@example.com");
    expect(JSON.stringify(result)).not.toContain(Buffer.alloc(32, 0x42).toString("hex"));
  });

  it("returns null for an unknown public ID", () => {
    expect(getPublicAppointment(database.context, "zyxwvutsrqponmlkjihgfedc")).toBeNull();
  });
});
