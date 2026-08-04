import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { getTableColumns, getTableName } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeParticipantName } from "../features/appointments/validation";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
  rateLimitWindows,
  responses,
} from "./schema";

const applicationTables = {
  appointments,
  appointmentManagers,
  participants,
  appointmentOptions,
  responses,
  guestSessions,
  guestSessionAccess,
  rateLimitWindows,
};

type SQLiteValue = string | number | null;

interface AppointmentRow {
  id: SQLiteValue;
  publicId: SQLiteValue;
  ownerUserId: SQLiteValue;
  title: SQLiteValue;
  description: SQLiteValue;
  type: SQLiteValue;
  status: SQLiteValue;
  optionLimit: SQLiteValue;
  finalOptionId: SQLiteValue;
  revision: SQLiteValue;
  createdAt: SQLiteValue;
  updatedAt: SQLiteValue;
}

interface ManagerRow {
  id: string;
  appointmentId: string;
  emailNormalized: string;
  userId: string | null;
  role: string;
  createdAt: number;
}

interface ParticipantRow {
  id: string;
  appointmentId: string;
  userId: string | null;
  displayName: string;
  normalizedName: string;
  editTokenHash: Buffer | null;
  createdAt: number;
  updatedAt: number;
}

const now = 1_800_000_000_000;
const validAppointment: AppointmentRow = {
  id: "appointment-active",
  publicId: "0123456789abcdefghijklmn",
  ownerUserId: "owner-user",
  title: "Planning",
  description: null,
  type: "DATE",
  status: "ACTIVE",
  optionLimit: 10,
  finalOptionId: null,
  revision: 1,
  createdAt: now,
  updatedAt: now + 1,
};

let schemaTemporaryDirectory: string | undefined;
let generatedSchemaSql: string;

beforeAll(() => {
  schemaTemporaryDirectory = mkdtempSync(join(tmpdir(), "appointly-task-8-schema-"));
  const migrationDirectory = join(schemaTemporaryDirectory, "drizzle");
  const configPath = join(schemaTemporaryDirectory, "drizzle.config.ts");

  writeFileSync(
    configPath,
    [
      "export default {",
      '  dialect: "sqlite",',
      `  schema: ${JSON.stringify([
        join(process.cwd(), "src/db/auth-schema.ts"),
        join(process.cwd(), "src/db/schema.ts"),
      ])},`,
      `  out: ${JSON.stringify(migrationDirectory)},`,
      "};",
      "",
    ].join("\n"),
  );

  const generation = spawnSync(
    process.execPath,
    [join(process.cwd(), "node_modules/drizzle-kit/bin.cjs"), "generate", "--config", configPath, "--name", "task-8-schema"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(generation.status, `${generation.stdout}\n${generation.stderr}`).toBe(0);

  const migrationFile = readdirSync(migrationDirectory).find((file) => file.endsWith(".sql"));
  expect(migrationFile).toBeDefined();
  generatedSchemaSql = readFileSync(join(migrationDirectory, migrationFile!), "utf8");
});

afterAll(() => {
  if (schemaTemporaryDirectory) {
    rmSync(schemaTemporaryDirectory, { force: true, recursive: true });
  }
});

function createSchemaDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");

  for (const statement of generatedSchemaSql.split("--> statement-breakpoint")) {
    if (statement.trim()) {
      sqlite.exec(statement);
    }
  }

  sqlite.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("owner-user", "Owner", "owner@example.com", 1, now, now);

  return sqlite;
}

function withSchemaDatabase<T>(operation: (sqlite: Database.Database) => T): T {
  const sqlite = createSchemaDatabase();
  try {
    return operation(sqlite);
  } finally {
    sqlite.close();
  }
}

function insertAppointment(
  sqlite: Database.Database,
  overrides: Partial<AppointmentRow> = {},
): void {
  const values = { ...validAppointment, ...overrides };
  sqlite.prepare(
    `INSERT INTO appointments (
      id, public_id, owner_user_id, title, description, type, status,
      option_limit, final_option_id, revision, created_at, updated_at
    ) VALUES (
      @id, @publicId, @ownerUserId, @title, @description, @type, @status,
      @optionLimit, @finalOptionId, @revision, @createdAt, @updatedAt
    )`,
  ).run(values);
}

function insertUser(sqlite: Database.Database, id: string): void {
  sqlite.prepare(
    `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, id, `${id}@example.com`, 1, now, now);
}

function insertManager(
  sqlite: Database.Database,
  overrides: Partial<ManagerRow> = {},
): void {
  const values: ManagerRow = {
    id: "manager-coorganizer",
    appointmentId: validAppointment.id as string,
    emailNormalized: "coorganizer@example.com",
    userId: null,
    role: "COORGANIZER",
    createdAt: now + 2,
    ...overrides,
  };
  sqlite.prepare(
    `INSERT INTO appointment_managers (
      id, appointment_id, email_normalized, user_id, role, created_at
    ) VALUES (
      @id, @appointmentId, @emailNormalized, @userId, @role, @createdAt
    )`,
  ).run(values);
}

function insertParticipant(
  sqlite: Database.Database,
  overrides: Partial<ParticipantRow> = {},
): void {
  const values: ParticipantRow = {
    id: "participant-guest",
    appointmentId: validAppointment.id as string,
    userId: null,
    displayName: "Guest",
    normalizedName: "guest",
    editTokenHash: null,
    createdAt: now + 2,
    updatedAt: now + 3,
    ...overrides,
  };
  sqlite.prepare(
    `INSERT INTO participants (
      id, appointment_id, user_id, display_name, normalized_name,
      edit_token_hash, created_at, updated_at
    ) VALUES (
      @id, @appointmentId, @userId, @displayName, @normalizedName,
      @editTokenHash, @createdAt, @updatedAt
    )`,
  ).run(values);
}

function insertOption(
  sqlite: Database.Database,
  appointmentId: string,
  optionId = "option-final",
): void {
  insertParticipant(sqlite, {
    id: "participant-owner",
    appointmentId,
    displayName: "Owner",
    normalizedName: "owner",
  });
  sqlite.prepare(
    `INSERT INTO appointment_options (
      id, appointment_id, creator_participant_id, start_date, end_date,
      start_at, end_at, canonical_key, created_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(optionId, appointmentId, "participant-owner", "2026-08-03", "D:2026-08-03", now + 2);
}

it("exports every application table under its SQLite name", () => {
  expect(Object.fromEntries(
    Object.entries(applicationTables).map(([exportName, table]) => [exportName, getTableName(table)]),
  )).toEqual({
    appointments: "appointments",
    appointmentManagers: "appointment_managers",
    participants: "participants",
    appointmentOptions: "appointment_options",
    responses: "responses",
    guestSessions: "guest_sessions",
    guestSessionAccess: "guest_session_access",
    rateLimitWindows: "rate_limit_windows",
  });
});

it.each([
  [appointments, ["id", "publicId", "ownerUserId", "title", "description", "type", "status", "optionLimit", "finalOptionId", "revision", "createdAt", "updatedAt"]],
  [appointmentManagers, ["id", "appointmentId", "emailNormalized", "userId", "role", "createdAt"]],
  [participants, ["id", "appointmentId", "userId", "displayName", "normalizedName", "editTokenHash", "createdAt", "updatedAt"]],
  [appointmentOptions, ["id", "appointmentId", "creatorParticipantId", "startDate", "endDate", "startAt", "endAt", "canonicalKey", "createdAt"]],
  [responses, ["appointmentId", "participantId", "optionId", "value", "updatedAt"]],
  [guestSessions, ["tokenHash", "expiresAt", "createdAt", "lastSeenAt"]],
  [guestSessionAccess, ["sessionTokenHash", "participantId", "createdAt"]],
  [rateLimitWindows, ["key", "count", "windowStartedAt", "expiresAt"]],
])("declares the complete base column set for %#", (table, expectedColumns) => {
  expect(Object.keys(getTableColumns(table))).toEqual(expectedColumns);
});

it("uses text UUID application IDs and integer UTC timestamp foundations", () => {
  for (const table of [appointments, appointmentManagers, participants, appointmentOptions]) {
    const id = getTableColumns(table).id;
    expect(id.dataType).toBe("string");
    expect(id.primary).toBe(true);
    expect(id.hasDefault).toBe(true);
  }

  const timestampColumns = [
    appointments.createdAt,
    appointments.updatedAt,
    appointmentManagers.createdAt,
    participants.createdAt,
    participants.updatedAt,
    appointmentOptions.createdAt,
    responses.updatedAt,
    guestSessions.expiresAt,
    guestSessions.createdAt,
    guestSessions.lastSeenAt,
    guestSessionAccess.createdAt,
    rateLimitWindows.windowStartedAt,
    rateLimitWindows.expiresAt,
  ];

  for (const column of timestampColumns) {
    expect(column.dataType).toBe("number");
    expect(column.notNull).toBe(true);
  }
});

it("round-trips the application storage foundations through generated SQLite DDL", () => {
  withSchemaDatabase((sqlite) => {
    const db = drizzle(sqlite, { schema: applicationTables });
    const participantDigest = Buffer.alloc(32, 0x11);
    const sessionDigest = Buffer.alloc(32, 0x22);
    const rateKey = Buffer.alloc(32, 0x33);

    const [appointment] = db.insert(appointments).values({
      publicId: "012345678901234567890123",
      ownerUserId: "owner-user",
      title: "Planning",
      description: null,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 10,
      finalOptionId: null,
      revision: 1,
      createdAt: now,
      updatedAt: now + 1,
    }).returning({ id: appointments.id }).all();
    const [manager] = db.insert(appointmentManagers).values({
      appointmentId: appointment.id,
      emailNormalized: "owner@example.com",
      userId: null,
      role: "OWNER",
      createdAt: now + 2,
    }).returning({ id: appointmentManagers.id }).all();
    const [participant] = db.insert(participants).values({
      appointmentId: appointment.id,
      userId: null,
      displayName: "Owner",
      normalizedName: "owner",
      editTokenHash: participantDigest,
      createdAt: now + 3,
      updatedAt: now + 4,
    }).returning({ id: participants.id }).all();
    const [option] = db.insert(appointmentOptions).values({
      appointmentId: appointment.id,
      creatorParticipantId: participant.id,
      startDate: "2026-08-03",
      endDate: null,
      startAt: null,
      endAt: null,
      canonicalKey: "D:2026-08-03",
      createdAt: now + 5,
    }).returning({ id: appointmentOptions.id }).all();

    db.insert(responses).values({
      appointmentId: appointment.id,
      participantId: participant.id,
      optionId: option.id,
      value: "YES",
      updatedAt: now + 6,
    }).run();
    db.insert(guestSessions).values({
      tokenHash: sessionDigest,
      expiresAt: now + 10_000,
      createdAt: now,
      lastSeenAt: now + 7,
    }).run();
    db.insert(guestSessionAccess).values({
      sessionTokenHash: sessionDigest,
      participantId: participant.id,
      createdAt: now + 8,
    }).run();
    db.insert(rateLimitWindows).values({
      key: rateKey,
      count: 1,
      windowStartedAt: now,
      expiresAt: now + 60_000,
    }).run();

    for (const id of [appointment.id, manager.id, participant.id, option.id]) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }

    expect(db.select().from(appointments).get()).toMatchObject({
      id: appointment.id,
      createdAt: now,
      updatedAt: now + 1,
    });
    expect(db.select().from(participants).get()?.editTokenHash).toEqual(participantDigest);
    expect(db.select().from(guestSessions).get()?.tokenHash).toEqual(sessionDigest);
    expect(db.select().from(guestSessionAccess).get()?.sessionTokenHash).toEqual(sessionDigest);
    expect(db.select().from(rateLimitWindows).get()?.key).toEqual(rateKey);
  });
});

describe("appointments SQLite constraints", () => {
  it("accepts a valid active appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(sqlite.prepare("SELECT status, final_option_id FROM appointments").get()).toEqual({
        status: "ACTIVE",
        final_option_id: null,
      });
    });
  });

  it.each(["DATE", "DATE_TIME", "DATE_RANGE", "DATE_TIME_RANGE"])(
    "accepts the exact appointment type %s",
    (type) => {
      withSchemaDatabase((sqlite) => {
        insertAppointment(sqlite, { type });
      });
    },
  );

  it.each(["date", "DATETIME", "DATE-TIME-RANGE", ""])(
    "rejects invalid appointment type %j",
    (type) => {
      withSchemaDatabase((sqlite) => {
        expect(() => insertAppointment(sqlite, { type })).toThrow();
      });
    },
  );

  it.each(["active", "FINAL", "CANCELLED", ""])(
    "rejects invalid appointment status %j",
    (status) => {
      withSchemaDatabase((sqlite) => {
        expect(() => insertAppointment(sqlite, { status })).toThrow();
      });
    },
  );

  it("defaults the option limit to 10", () => {
    withSchemaDatabase((sqlite) => {
      sqlite.prepare(
        `INSERT INTO appointments (
          id, public_id, owner_user_id, title, description, type, status,
          final_option_id, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        "appointment-default-limit",
        "abcdefghijklmnopqrstuvwx",
        "owner-user",
        "Planning",
        "DATE",
        "ACTIVE",
        1,
        now,
        now,
      );

      expect(sqlite.prepare(
        "SELECT option_limit FROM appointments WHERE id = ?",
      ).pluck().get("appointment-default-limit")).toBe(10);
    });
  });

  it.each([0, 101, 1.5])("rejects invalid option limit %s", (optionLimit) => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, { optionLimit })).toThrow();
    });
  });

  it.each([1, 100])("accepts option limit boundary %s", (optionLimit) => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite, { optionLimit });
    });
  });

  it("rejects revisions below one", () => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, { revision: 0 })).toThrow();
    });
  });

  it.each(["", "x".repeat(121)])("rejects an invalid title length", (title) => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, { title })).toThrow();
    });
  });

  it("accepts a 120-character title", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite, { title: "x".repeat(120) });
    });
  });

  it("rejects a description over 2,000 characters", () => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, { description: "x".repeat(2_001) })).toThrow();
    });
  });

  it("accepts a null or 2,000-character description", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite, { description: "x".repeat(2_000) });
    });
  });

  it("rejects an active appointment with a final option", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertOption(sqlite, "appointment-active");
      expect(() => sqlite.prepare(
        "UPDATE appointments SET final_option_id = ? WHERE id = ?",
      ).run("option-final", "appointment-active")).toThrow();
    });
  });

  it("rejects a finalized appointment without a final option", () => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, {
        status: "FINALIZED",
        finalOptionId: null,
      })).toThrow();
    });
  });

  it("accepts a finalized appointment linked to an existing option with foreign keys enabled", () => {
    withSchemaDatabase((sqlite) => {
      sqlite.exec("BEGIN");
      sqlite.pragma("defer_foreign_keys = ON");
      insertAppointment(sqlite, {
        id: "appointment-finalized",
        publicId: "zyxwvutsrqponmlkjihgfedc",
        status: "FINALIZED",
        finalOptionId: "option-final",
      });
      insertOption(sqlite, "appointment-finalized");
      sqlite.exec("COMMIT");

      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(sqlite.prepare(
        "SELECT status, final_option_id FROM appointments WHERE id = ?",
      ).get("appointment-finalized")).toEqual({
        status: "FINALIZED",
        final_option_id: "option-final",
      });
    });
  });

  it("rejects a final option that does not exist", () => {
    withSchemaDatabase((sqlite) => {
      sqlite.exec("BEGIN");
      sqlite.pragma("defer_foreign_keys = ON");
      insertAppointment(sqlite, {
        status: "FINALIZED",
        finalOptionId: "missing-option",
      });
      expect(() => sqlite.exec("COMMIT")).toThrow();
      sqlite.exec("ROLLBACK");
    });
  });

  it("declares final option deletion as SET NULL", () => {
    withSchemaDatabase((sqlite) => {
      const foreignKeys = sqlite.pragma("foreign_key_list(appointments)") as Array<{
        from: string;
        table: string;
        on_delete: string;
      }>;
      expect(foreignKeys).toContainEqual(expect.objectContaining({
        from: "final_option_id",
        table: "appointment_options",
        on_delete: "SET NULL",
      }));
    });
  });

  it("restricts deletion of an owner with an appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => sqlite.prepare("DELETE FROM user WHERE id = ?").run("owner-user")).toThrow();
    });
  });

  it("requires a unique 24-character base64url public ID", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => insertAppointment(sqlite, {
        id: "appointment-duplicate-public-id",
      })).toThrow();
    });
  });

  it.each([
    "short",
    "0123456789012345678901234",
    "01234567890123456789012=",
    "01234567890123456789012+",
  ])("rejects invalid public ID %j", (publicId) => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, { publicId })).toThrow();
    });
  });

  it.each([
    { createdAt: null },
    { createdAt: "not-an-integer" },
    { updatedAt: null },
    { updatedAt: "not-an-integer" },
  ])("requires non-null integer appointment times", (override) => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, override)).toThrow();
    });
  });

  it.each([
    { id: "" },
    { ownerUserId: "" },
  ])("rejects empty required appointment identifiers", (override) => {
    withSchemaDatabase((sqlite) => {
      expect(() => insertAppointment(sqlite, override)).toThrow();
    });
  });
});

describe("manager and participant identity constraints", () => {
  it.each(["OWNER", "COORGANIZER"])("accepts the exact manager role %s", (role) => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite, { role });
    });
  });

  it.each(["owner", "CO_ORGANIZER", "MANAGER", ""])(
    "rejects invalid manager role %j",
    (role) => {
      withSchemaDatabase((sqlite) => {
        insertAppointment(sqlite);
        expect(() => insertManager(sqlite, { role })).toThrow();
      });
    },
  );

  it("allows one normalized manager email per appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite);
      expect(() => insertManager(sqlite, {
        id: "manager-duplicate-email",
        emailNormalized: "coorganizer@example.com",
      })).toThrow();
    });
  });

  it("allows only one owner per appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite, {
        id: "manager-owner",
        emailNormalized: "owner@example.com",
        role: "OWNER",
      });
      expect(() => insertManager(sqlite, {
        id: "manager-second-owner",
        emailNormalized: "second-owner@example.com",
        role: "OWNER",
      })).toThrow();
    });
  });

  it("allows one non-null manager user link per appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertUser(sqlite, "linked-user");
      insertManager(sqlite, { userId: "linked-user" });
      expect(() => insertManager(sqlite, {
        id: "manager-duplicate-user",
        emailNormalized: "other@example.com",
        userId: "linked-user",
      })).toThrow();
    });
  });

  it("allows duplicate null manager user links", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite);
      insertManager(sqlite, {
        id: "manager-other",
        emailNormalized: "other@example.com",
      });
      expect(sqlite.prepare(
        "SELECT count(*) FROM appointment_managers WHERE user_id IS NULL",
      ).pluck().get()).toBe(2);
    });
  });

  it("conflicts equivalent normalized names within one appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertParticipant(sqlite, normalizeParticipantName("Alice"));

      expect(() => insertParticipant(sqlite, {
        id: "participant-equivalent-name",
        ...normalizeParticipantName("ＡＬＩＣＥ"),
      })).toThrow();
    });
  });

  it("allows equivalent normalized names in different appointments", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertParticipant(sqlite, normalizeParticipantName("Alice"));
      insertAppointment(sqlite, {
        id: "appointment-other",
        publicId: "abcdefghijklmnopqrstuvwx",
      });

      insertParticipant(sqlite, {
        id: "participant-other-appointment",
        appointmentId: "appointment-other",
        ...normalizeParticipantName("ＡＬＩＣＥ"),
      });
    });
  });

  it.each([
    ["one display-name code point", "x"],
    ["80 display-name code points including astral characters", "😀".repeat(80)],
  ])("accepts %s", (_case, displayName) => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertParticipant(sqlite, { displayName });
    });
  });

  it.each([
    ["an empty display name", ""],
    ["81 display-name code points", "😀".repeat(81)],
  ])("rejects %s", (_case, displayName) => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => insertParticipant(sqlite, { displayName })).toThrow();
    });
  });

  it("accepts an 80-code-point display name whose lowercase comparison expands", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertParticipant(sqlite, normalizeParticipantName("\u0130".repeat(80)));
    });
  });

  it("rejects an empty normalized name", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => insertParticipant(sqlite, { normalizedName: "" })).toThrow();
    });
  });

  it("allows one non-null participant user link per appointment", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertUser(sqlite, "linked-user");
      insertParticipant(sqlite, { userId: "linked-user" });
      expect(() => insertParticipant(sqlite, {
        id: "participant-duplicate-user",
        displayName: "Other",
        normalizedName: "other",
        userId: "linked-user",
      })).toThrow();
    });
  });

  it("allows duplicate null participant user links", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertParticipant(sqlite);
      insertParticipant(sqlite, {
        id: "participant-other",
        displayName: "Other",
        normalizedName: "other",
      });
      expect(sqlite.prepare(
        "SELECT count(*) FROM participants WHERE user_id IS NULL",
      ).pluck().get()).toBe(2);
    });
  });

  it.each([null, Buffer.alloc(32)])(
    "accepts nullable 32-byte participant edit digest %#",
    (editTokenHash) => {
      withSchemaDatabase((sqlite) => {
        insertAppointment(sqlite);
        insertParticipant(sqlite, { editTokenHash });
      });
    },
  );

  it.each([0, 31, 33])(
    "rejects a participant edit digest with length %i",
    (length) => {
      withSchemaDatabase((sqlite) => {
        insertAppointment(sqlite);
        expect(() => insertParticipant(sqlite, {
          editTokenHash: Buffer.alloc(length),
        })).toThrow();
      });
    },
  );

  it("rejects a 32-character TEXT participant edit digest", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => sqlite.prepare(
        `INSERT INTO participants (
          id, appointment_id, user_id, display_name, normalized_name,
          edit_token_hash, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
      ).run(
        "participant-text-digest",
        validAppointment.id,
        "Guest",
        "guest",
        "x".repeat(32),
        now + 2,
        now + 3,
      )).toThrow();
    });
  });

  it("rejects missing manager appointment and user parents", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => insertManager(sqlite, {
        appointmentId: "missing-appointment",
      })).toThrow();
      expect(() => insertManager(sqlite, {
        userId: "missing-user",
      })).toThrow();
    });
  });

  it("rejects missing participant appointment and user parents", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      expect(() => insertParticipant(sqlite, {
        appointmentId: "missing-appointment",
      })).toThrow();
      expect(() => insertParticipant(sqlite, {
        userId: "missing-user",
      })).toThrow();
    });
  });

  it("cascades manager and participant rows when an appointment is deleted", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite);
      insertParticipant(sqlite);

      sqlite.prepare("DELETE FROM appointments WHERE id = ?").run(validAppointment.id);

      expect(sqlite.prepare(
        "SELECT count(*) FROM appointment_managers",
      ).pluck().get()).toBe(0);
      expect(sqlite.prepare(
        "SELECT count(*) FROM participants",
      ).pluck().get()).toBe(0);
    });
  });

  it("sets manager and participant links to null when a non-owner user is deleted", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertUser(sqlite, "linked-user");
      insertManager(sqlite, { userId: "linked-user" });
      insertParticipant(sqlite, { userId: "linked-user" });

      sqlite.prepare("DELETE FROM user WHERE id = ?").run("linked-user");

      expect(sqlite.prepare(
        "SELECT user_id FROM appointment_managers",
      ).pluck().get()).toBeNull();
      expect(sqlite.prepare(
        "SELECT user_id FROM participants",
      ).pluck().get()).toBeNull();
    });
  });

  it("declares the scoped unique and lookup indexes", () => {
    withSchemaDatabase((sqlite) => {
      const indexes = (table: string) =>
        (sqlite.pragma(`index_list(${table})`) as Array<{
          name: string;
          unique: number;
          partial: number;
        }>).map((index) => ({
          columns: (sqlite.pragma(`index_info(${index.name})`) as Array<{
            name: string;
          }>).map((column) => column.name),
          partial: index.partial,
          unique: index.unique,
        }));

      expect(indexes("appointment_managers")).toEqual(expect.arrayContaining([
        { columns: ["appointment_id", "email_normalized"], partial: 0, unique: 1 },
        { columns: ["appointment_id", "user_id"], partial: 1, unique: 1 },
        { columns: ["appointment_id"], partial: 1, unique: 1 },
        { columns: ["email_normalized"], partial: 0, unique: 0 },
        { columns: ["user_id"], partial: 0, unique: 0 },
      ]));
      expect(indexes("participants")).toEqual(expect.arrayContaining([
        { columns: ["appointment_id", "id"], partial: 0, unique: 1 },
        { columns: ["appointment_id", "normalized_name"], partial: 0, unique: 1 },
        { columns: ["appointment_id", "user_id"], partial: 1, unique: 1 },
        { columns: ["normalized_name"], partial: 0, unique: 0 },
        { columns: ["user_id"], partial: 0, unique: 0 },
      ]));
    });
  });
});


interface OptionRow {
  id: string;
  appointmentId: string;
  creatorParticipantId: string;
  startDate: string | null;
  endDate: string | null;
  startAt: number | null;
  endAt: number | null;
  canonicalKey: string;
  createdAt: number;
}

interface ResponseRow {
  appointmentId: string;
  participantId: string;
  optionId: string;
  value: string | null;
  updatedAt: number;
}

function seedOptionParent(
  sqlite: Database.Database,
  appointmentId = "appointment-active",
  participantId = "participant-a",
  publicId = "0123456789abcdefghijklmn",
): void {
  insertAppointment(sqlite, { id: appointmentId, publicId });
  insertParticipant(sqlite, {
    id: participantId,
    appointmentId,
    displayName: participantId,
    normalizedName: participantId,
  });
}

function insertOptionRow(
  sqlite: Database.Database,
  overrides: Partial<OptionRow> = {},
): void {
  const values: OptionRow = {
    id: "option-a",
    appointmentId: "appointment-active",
    creatorParticipantId: "participant-a",
    startDate: "2026-08-03",
    endDate: null,
    startAt: null,
    endAt: null,
    canonicalKey: "D:2026-08-03",
    createdAt: now + 4,
    ...overrides,
  };
  sqlite.prepare(
    `INSERT INTO appointment_options (
      id, appointment_id, creator_participant_id, start_date, end_date,
      start_at, end_at, canonical_key, created_at
    ) VALUES (
      @id, @appointmentId, @creatorParticipantId, @startDate, @endDate,
      @startAt, @endAt, @canonicalKey, @createdAt
    )`,
  ).run(values);
}

function insertResponseRow(
  sqlite: Database.Database,
  overrides: Partial<ResponseRow> = {},
): void {
  const values: ResponseRow = {
    appointmentId: "appointment-active",
    participantId: "participant-a",
    optionId: "option-a",
    value: "YES",
    updatedAt: now + 5,
    ...overrides,
  };
  sqlite.prepare(
    `INSERT INTO responses (
      appointment_id, participant_id, option_id, value, updated_at
    ) VALUES (
      @appointmentId, @participantId, @optionId, @value, @updatedAt
    )`,
  ).run(values);
}

describe("option and response SQLite constraints", () => {
  it.each([
    [
      "date",
      {
        startDate: "2026-08-03",
        endDate: null,
        startAt: null,
        endAt: null,
        canonicalKey: "D:2026-08-03",
      },
      { endAt: now + 10_000 },
    ],
    [
      "date range",
      {
        startDate: "2026-08-03",
        endDate: "2026-08-04",
        startAt: null,
        endAt: null,
        canonicalKey: "DR:2026-08-03/2026-08-04",
      },
      { startAt: now + 1_000 },
    ],
    [
      "timed instant",
      {
        startDate: null,
        endDate: null,
        startAt: now + 1_000,
        endAt: null,
        canonicalKey: `T:${now + 1_000}`,
      },
      { endDate: "2026-08-04" },
    ],
    [
      "timed range",
      {
        startDate: null,
        endDate: null,
        startAt: now + 1_000,
        endAt: now + 2_000,
        canonicalKey: `TR:${now + 1_000}/${now + 2_000}`,
      },
      { startDate: "2026-08-03" },
    ],
  ])("accepts the exact %s shape and rejects a mixed shape", (_name, shape, mixedFields) => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite, shape);

      expect(() => insertOptionRow(sqlite, {
        ...shape,
        ...mixedFields,
        id: "option-mixed",
        canonicalKey: `${shape.canonicalKey}:mixed`,
      })).toThrow(/CHECK constraint failed: appointment_options_shape/);
    });
  });

  it.each([
    ["all option value columns absent", {
      startDate: null,
      endDate: null,
      startAt: null,
      endAt: null,
    }],
    ["date end without a start", {
      startDate: null,
      endDate: "2026-08-04",
      startAt: null,
      endAt: null,
    }],
    ["timed end without a start", {
      startDate: null,
      endDate: null,
      startAt: null,
      endAt: now + 2_000,
    }],
    ["date and timed starts together", {
      startDate: "2026-08-03",
      endDate: null,
      startAt: now + 1_000,
      endAt: null,
    }],
  ])("rejects %s", (_name, shape) => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      expect(() => insertOptionRow(sqlite, shape)).toThrow(
        /CHECK constraint failed: appointment_options_shape/,
      );
    });
  });

  it("allows equal and ascending date ranges but rejects a descending range", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite, {
        id: "option-equal",
        startDate: "2026-08-03",
        endDate: "2026-08-03",
        canonicalKey: "DR:equal",
      });
      insertOptionRow(sqlite, {
        id: "option-ascending",
        startDate: "2026-08-03",
        endDate: "2026-08-04",
        canonicalKey: "DR:ascending",
      });

      expect(() => insertOptionRow(sqlite, {
        id: "option-descending",
        startDate: "2026-08-04",
        endDate: "2026-08-03",
        canonicalKey: "DR:descending",
      })).toThrow(/CHECK constraint failed: appointment_options_shape/);
    });
  });

  it("requires a timed range end to be strictly after its start", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite, {
        id: "option-ascending",
        startDate: null,
        startAt: now + 1_000,
        endAt: now + 2_000,
        canonicalKey: "TR:ascending",
      });

      for (const [id, endAt] of [
        ["option-equal", now + 1_000],
        ["option-descending", now],
      ] as const) {
        expect(() => insertOptionRow(sqlite, {
          id,
          startDate: null,
          startAt: now + 1_000,
          endAt,
          canonicalKey: `TR:${id}`,
        })).toThrow(/CHECK constraint failed: appointment_options_shape/);
      }
    });
  });

  it("scopes canonical-key uniqueness to one appointment", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      expect(() => insertOptionRow(sqlite, {
        id: "option-duplicate",
      })).toThrow(
        /UNIQUE constraint failed: appointment_options.appointment_id, appointment_options.canonical_key/,
      );

      seedOptionParent(
        sqlite,
        "appointment-other",
        "participant-other",
        "abcdefghijklmnopqrstuvwx",
      );
      insertOptionRow(sqlite, {
        id: "option-other",
        appointmentId: "appointment-other",
        creatorParticipantId: "participant-other",
      });
    });
  });

  it("rejects an option creator from another appointment", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      seedOptionParent(
        sqlite,
        "appointment-other",
        "participant-other",
        "abcdefghijklmnopqrstuvwx",
      );

      expect(() => insertOptionRow(sqlite, {
        creatorParticipantId: "participant-other",
      })).toThrow(/FOREIGN KEY constraint failed/);
    });
  });

  it.each([
    ["participant", {
      participantId: "participant-other",
      optionId: "option-a",
    }],
    ["option", {
      participantId: "participant-a",
      optionId: "option-other",
    }],
  ])("rejects a response whose %s belongs to another appointment", (_name, ids) => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      seedOptionParent(
        sqlite,
        "appointment-other",
        "participant-other",
        "abcdefghijklmnopqrstuvwx",
      );
      insertOptionRow(sqlite, {
        id: "option-other",
        appointmentId: "appointment-other",
        creatorParticipantId: "participant-other",
        canonicalKey: "D:other",
      });

      expect(() => insertResponseRow(sqlite, ids)).toThrow(
        /FOREIGN KEY constraint failed/,
      );
    });
  });

  it("stores only exact YES and NO response values", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      insertOptionRow(sqlite, {
        id: "option-b",
        canonicalKey: "D:option-b",
      });
      insertResponseRow(sqlite);
      insertResponseRow(sqlite, {
        optionId: "option-b",
        value: "NO",
      });

      expect(sqlite.prepare(
        "SELECT value FROM responses ORDER BY option_id",
      ).pluck().all()).toEqual(["YES", "NO"]);
      sqlite.prepare("DELETE FROM responses WHERE option_id = ?").run("option-b");

      for (const value of ["yes", "MAYBE", ""]) {
        expect(() => insertResponseRow(sqlite, {
          optionId: "option-b",
          value,
          updatedAt: now + 6,
        })).toThrow(/CHECK constraint failed: responses_value_values/);
      }
      expect(() => insertResponseRow(sqlite, {
        optionId: "option-b",
        value: null,
        updatedAt: now + 6,
      })).toThrow(/NOT NULL constraint failed: responses.value/);
    });
  });

  it("uses the response appointment, participant, and option as one primary key", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      insertResponseRow(sqlite);

      expect(() => insertResponseRow(sqlite, {
        value: "NO",
        updatedAt: now + 6,
      })).toThrow(
        /UNIQUE constraint failed: responses.appointment_id, responses.participant_id, responses.option_id/,
      );
    });
  });

  it("cascades option deletion to its responses", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      insertResponseRow(sqlite);

      sqlite.prepare("DELETE FROM appointment_options WHERE id = ?").run("option-a");

      expect(sqlite.prepare("SELECT count(*) FROM responses").pluck().get()).toBe(0);
      expect(sqlite.prepare("SELECT count(*) FROM participants").pluck().get()).toBe(1);
    });
  });

  it("cascades participant deletion to their responses without deleting the option", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertParticipant(sqlite, {
        id: "participant-responder",
        appointmentId: "appointment-active",
        displayName: "Responder",
        normalizedName: "responder",
      });
      insertOptionRow(sqlite);
      insertResponseRow(sqlite, {
        participantId: "participant-responder",
      });

      sqlite.prepare("DELETE FROM participants WHERE id = ?").run("participant-responder");

      expect(sqlite.prepare("SELECT count(*) FROM responses").pluck().get()).toBe(0);
      expect(sqlite.prepare("SELECT count(*) FROM appointment_options").pluck().get()).toBe(1);
    });
  });

  it("cascades creator deletion to their options", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);

      sqlite.prepare("DELETE FROM participants WHERE id = ?").run("participant-a");

      expect(sqlite.prepare("SELECT count(*) FROM appointment_options").pluck().get()).toBe(0);
    });
  });

  it("cascades appointment deletion to options and responses", () => {
    withSchemaDatabase((sqlite) => {
      seedOptionParent(sqlite);
      insertOptionRow(sqlite);
      insertResponseRow(sqlite);

      sqlite.prepare("DELETE FROM appointments WHERE id = ?").run("appointment-active");

      expect(sqlite.prepare("SELECT count(*) FROM appointment_options").pluck().get()).toBe(0);
      expect(sqlite.prepare("SELECT count(*) FROM responses").pluck().get()).toBe(0);
    });
  });

  it("declares composite parent keys and option and response lookup indexes", () => {
    withSchemaDatabase((sqlite) => {
      const indexes = (table: string) =>
        (sqlite.pragma(`index_list(${table})`) as Array<{
          name: string;
          unique: number;
          partial: number;
        }>).map((entry) => ({
          columns: (sqlite.pragma(`index_info(${entry.name})`) as Array<{
            name: string;
          }>).map((column) => column.name),
          partial: entry.partial,
          unique: entry.unique,
        }));

      expect(indexes("participants")).toEqual(expect.arrayContaining([
        { columns: ["appointment_id", "id"], partial: 0, unique: 1 },
      ]));
      expect(indexes("appointment_options")).toEqual(expect.arrayContaining([
        { columns: ["appointment_id", "id"], partial: 0, unique: 1 },
        { columns: ["appointment_id", "canonical_key"], partial: 0, unique: 1 },
        {
          columns: ["appointment_id", "creator_participant_id"],
          partial: 0,
          unique: 0,
        },
        {
          columns: ["appointment_id", "start_date", "start_at", "created_at", "id"],
          partial: 0,
          unique: 0,
        },
      ]));
      expect(indexes("responses")).toEqual(expect.arrayContaining([
        {
          columns: ["appointment_id", "participant_id", "option_id"],
          partial: 0,
          unique: 1,
        },
        { columns: ["appointment_id", "option_id"], partial: 0, unique: 0 },
        { columns: ["appointment_id", "participant_id"], partial: 0, unique: 0 },
      ]));
    });
  });
});

describe("guest session, access, and rate window SQLite constraints", () => {
  function insertGuestSession(
    sqlite: Database.Database,
    tokenHash: Buffer | string,
    overrides: Partial<{
      createdAt: number;
      expiresAt: number;
      lastSeenAt: number;
    }> = {},
  ): void {
    sqlite.prepare(
      `INSERT INTO guest_sessions (token_hash, expires_at, created_at, last_seen_at)
       VALUES (@tokenHash, @expiresAt, @createdAt, @lastSeenAt)`,
    ).run({
      tokenHash,
      createdAt: now,
      expiresAt: now + 31_536_000_000,
      lastSeenAt: now,
      ...overrides,
    });
  }

  function insertGuestAccess(
    sqlite: Database.Database,
    sessionTokenHash: Buffer | string,
    participantId = "participant-a",
  ): void {
    sqlite.prepare(
      `INSERT INTO guest_session_access (
        session_token_hash, participant_id, created_at
      ) VALUES (?, ?, ?)`,
    ).run(sessionTokenHash, participantId, now);
  }

  function insertRateWindow(
    sqlite: Database.Database,
    key: Buffer | string,
    overrides: Partial<{
      count: number;
      expiresAt: number;
      windowStartedAt: number;
    }> = {},
  ): void {
    sqlite.prepare(
      `INSERT INTO rate_limit_windows (
        key, count, window_started_at, expires_at
      ) VALUES (@key, @count, @windowStartedAt, @expiresAt)`,
    ).run({
      key,
      count: 0,
      windowStartedAt: now,
      expiresAt: now + 60_000,
      ...overrides,
    });
  }

  function seedGuestParticipant(sqlite: Database.Database, id = "participant-a"): void {
    insertAppointment(sqlite);
    insertParticipant(sqlite, {
      id,
      appointmentId: "appointment-active",
      displayName: id,
      normalizedName: id,
    });
  }

  it("stores a guest session token only as an exact 32-byte BLOB", () => {
    withSchemaDatabase((sqlite) => {
      const digest = Buffer.alloc(32, 0x61);
      insertGuestSession(sqlite, digest);

      expect(sqlite.prepare(
        `SELECT typeof(token_hash) AS storageClass, length(token_hash) AS byteLength
         FROM guest_sessions`,
      ).get()).toEqual({ storageClass: "blob", byteLength: 32 });
      expect(() => insertGuestSession(sqlite, Buffer.alloc(31, 0x62))).toThrow();
      expect(() => insertGuestSession(sqlite, Buffer.alloc(33, 0x63))).toThrow();
      expect(() => insertGuestSession(sqlite, "b".repeat(32))).toThrow();
    });
  });

  it("requires guest session expiry to follow creation", () => {
    withSchemaDatabase((sqlite) => {
      insertGuestSession(sqlite, Buffer.alloc(32, 0x01), {
        createdAt: now,
        expiresAt: now + 1,
      });
      expect(() => insertGuestSession(sqlite, Buffer.alloc(32, 0x02), {
        createdAt: now,
        expiresAt: now,
      })).toThrow();
      expect(() => insertGuestSession(sqlite, Buffer.alloc(32, 0x03), {
        createdAt: now,
        expiresAt: now - 1,
      })).toThrow();
    });
  });

  it("updates lastSeenAt without changing fixed session expiry", () => {
    withSchemaDatabase((sqlite) => {
      const digest = Buffer.alloc(32, 0x04);
      const fixedExpiry = now + 31_536_000_000;
      insertGuestSession(sqlite, digest, { expiresAt: fixedExpiry });

      sqlite.prepare(
        "UPDATE guest_sessions SET last_seen_at = ? WHERE token_hash = ?",
      ).run(now + 60_000, digest);

      expect(sqlite.prepare(
        `SELECT expires_at AS expiresAt, last_seen_at AS lastSeenAt
         FROM guest_sessions WHERE token_hash = ?`,
      ).get(digest)).toEqual({
        expiresAt: fixedExpiry,
        lastSeenAt: now + 60_000,
      });
    });
  });

  it("stores an access session digest only as an exact 32-byte BLOB", () => {
    withSchemaDatabase((sqlite) => {
      seedGuestParticipant(sqlite);
      const digest = Buffer.alloc(32, 0x11);
      insertGuestSession(sqlite, digest);
      insertGuestAccess(sqlite, digest);

      expect(sqlite.prepare(
        `SELECT typeof(session_token_hash) AS storageClass,
                length(session_token_hash) AS byteLength
         FROM guest_session_access`,
      ).get()).toEqual({ storageClass: "blob", byteLength: 32 });

      sqlite.pragma("foreign_keys = OFF");
      expect(() => insertGuestAccess(sqlite, Buffer.alloc(31, 0x12))).toThrow();
      expect(() => insertGuestAccess(sqlite, Buffer.alloc(33, 0x13))).toThrow();
      expect(() => insertGuestAccess(sqlite, "a".repeat(32))).toThrow();
    });
  });

  it("uses the exact session and participant pair as the access primary key", () => {
    withSchemaDatabase((sqlite) => {
      seedGuestParticipant(sqlite);
      insertParticipant(sqlite, {
        id: "participant-b",
        appointmentId: "appointment-active",
        displayName: "Participant B",
        normalizedName: "participant b",
      });
      const firstSession = Buffer.alloc(32, 0x21);
      const secondSession = Buffer.alloc(32, 0x22);
      insertGuestSession(sqlite, firstSession);
      insertGuestSession(sqlite, secondSession);

      insertGuestAccess(sqlite, firstSession);
      expect(() => insertGuestAccess(sqlite, firstSession)).toThrow();
      insertGuestAccess(sqlite, firstSession, "participant-b");
      insertGuestAccess(sqlite, secondSession);

      expect(sqlite.prepare("SELECT count(*) FROM guest_session_access").pluck().get()).toBe(3);
    });
  });

  it("cascades access deletion from its guest session", () => {
    withSchemaDatabase((sqlite) => {
      seedGuestParticipant(sqlite);
      const digest = Buffer.alloc(32, 0x31);
      insertGuestSession(sqlite, digest);
      insertGuestAccess(sqlite, digest);

      sqlite.prepare("DELETE FROM guest_sessions WHERE token_hash = ?").run(digest);

      expect(sqlite.prepare("SELECT count(*) FROM guest_session_access").pluck().get()).toBe(0);
      expect(sqlite.prepare("SELECT count(*) FROM participants").pluck().get()).toBe(1);
    });
  });

  it("cascades access deletion from its participant", () => {
    withSchemaDatabase((sqlite) => {
      seedGuestParticipant(sqlite);
      const digest = Buffer.alloc(32, 0x32);
      insertGuestSession(sqlite, digest);
      insertGuestAccess(sqlite, digest);

      sqlite.prepare("DELETE FROM participants WHERE id = ?").run("participant-a");

      expect(sqlite.prepare("SELECT count(*) FROM guest_session_access").pluck().get()).toBe(0);
      expect(sqlite.prepare("SELECT count(*) FROM guest_sessions").pluck().get()).toBe(1);
    });
  });

  it("deletes one complete appointment graph without touching unrelated records", () => {
    withSchemaDatabase((sqlite) => {
      insertAppointment(sqlite);
      insertManager(sqlite);
      insertParticipant(sqlite, {
        id: "participant-a",
        displayName: "Participant A",
        normalizedName: "participant a",
      });
      insertOptionRow(sqlite);
      insertResponseRow(sqlite);

      insertAppointment(sqlite, {
        id: "appointment-unrelated",
        publicId: "abcdefghijklmnopqrstuvwx",
        title: "Unrelated appointment",
      });
      insertManager(sqlite, {
        id: "manager-unrelated",
        appointmentId: "appointment-unrelated",
        emailNormalized: "unrelated@example.com",
      });
      insertParticipant(sqlite, {
        id: "participant-unrelated",
        appointmentId: "appointment-unrelated",
        displayName: "Unrelated participant",
        normalizedName: "unrelated participant",
      });
      insertOptionRow(sqlite, {
        id: "option-unrelated",
        appointmentId: "appointment-unrelated",
        creatorParticipantId: "participant-unrelated",
        startDate: "2026-08-04",
        canonicalKey: "D:2026-08-04",
      });
      insertResponseRow(sqlite, {
        appointmentId: "appointment-unrelated",
        participantId: "participant-unrelated",
        optionId: "option-unrelated",
      });

      const digest = Buffer.alloc(32, 0x33);
      insertGuestSession(sqlite, digest);
      insertGuestAccess(sqlite, digest);
      insertGuestAccess(sqlite, digest, "participant-unrelated");

      sqlite.prepare("DELETE FROM appointments WHERE id = ?").run("appointment-active");

      expect(sqlite.prepare(
        "SELECT count(*) FROM appointments WHERE id = ?",
      ).pluck().get("appointment-active")).toBe(0);
      expect(sqlite.prepare(
        "SELECT count(*) FROM appointments WHERE id = ?",
      ).pluck().get("appointment-unrelated")).toBe(1);
      for (const table of [
        "appointment_managers",
        "participants",
        "appointment_options",
        "responses",
      ]) {
        expect(sqlite.prepare(
          `SELECT count(*) FROM ${table} WHERE appointment_id = ?`,
        ).pluck().get("appointment-active")).toBe(0);
        expect(sqlite.prepare(
          `SELECT count(*) FROM ${table} WHERE appointment_id = ?`,
        ).pluck().get("appointment-unrelated")).toBe(1);
      }
      expect(sqlite.prepare(
        "SELECT participant_id FROM guest_session_access",
      ).pluck().all()).toEqual(["participant-unrelated"]);
      expect(sqlite.prepare("SELECT count(*) FROM guest_sessions").pluck().get()).toBe(1);
    });
  });

  it("stores a rate key only as an exact 32-byte BLOB", () => {
    withSchemaDatabase((sqlite) => {
      insertRateWindow(sqlite, Buffer.alloc(32, 0x41));

      expect(sqlite.prepare(
        `SELECT typeof(key) AS storageClass, length(key) AS byteLength
         FROM rate_limit_windows`,
      ).get()).toEqual({ storageClass: "blob", byteLength: 32 });
      expect(() => insertRateWindow(sqlite, Buffer.alloc(31, 0x42))).toThrow();
      expect(() => insertRateWindow(sqlite, Buffer.alloc(33, 0x43))).toThrow();
      expect(() => insertRateWindow(sqlite, "r".repeat(32))).toThrow();
    });
  });

  it("requires a nonnegative rate count", () => {
    withSchemaDatabase((sqlite) => {
      insertRateWindow(sqlite, Buffer.alloc(32, 0x51), { count: 0 });
      insertRateWindow(sqlite, Buffer.alloc(32, 0x52), { count: 1 });
      expect(() => insertRateWindow(sqlite, Buffer.alloc(32, 0x53), {
        count: -1,
      })).toThrow();
    });
  });

  it("requires rate expiry to follow the window start", () => {
    withSchemaDatabase((sqlite) => {
      insertRateWindow(sqlite, Buffer.alloc(32, 0x61), {
        windowStartedAt: now,
        expiresAt: now + 1,
      });
      expect(() => insertRateWindow(sqlite, Buffer.alloc(32, 0x62), {
        windowStartedAt: now,
        expiresAt: now,
      })).toThrow();
      expect(() => insertRateWindow(sqlite, Buffer.alloc(32, 0x63), {
        windowStartedAt: now,
        expiresAt: now - 1,
      })).toThrow();
    });
  });

  it("declares the required primary keys", () => {
    withSchemaDatabase((sqlite) => {
      const primaryKey = (table: string) =>
        (sqlite.pragma(`table_info(${table})`) as Array<{
          name: string;
          pk: number;
        }>)
          .filter((column) => column.pk > 0)
          .sort((left, right) => left.pk - right.pk)
          .map((column) => column.name);

      expect(primaryKey("guest_sessions")).toEqual(["token_hash"]);
      expect(primaryKey("guest_session_access")).toEqual([
        "session_token_hash",
        "participant_id",
      ]);
      expect(primaryKey("rate_limit_windows")).toEqual(["key"]);
    });
  });

  it("enforces guest session and rate window primary key uniqueness", () => {
    withSchemaDatabase((sqlite) => {
      const digest = Buffer.alloc(32, 0x71);
      const rateKey = Buffer.alloc(32, 0x72);
      insertGuestSession(sqlite, digest);
      insertRateWindow(sqlite, rateKey);

      expect(() => insertGuestSession(sqlite, digest)).toThrow();
      expect(() => insertRateWindow(sqlite, rateKey)).toThrow();
    });
  });

  it("indexes guest session and rate window expiry", () => {
    withSchemaDatabase((sqlite) => {
      const indexes = (table: string) =>
        (sqlite.pragma(`index_list(${table})`) as Array<{
          name: string;
          unique: number;
        }>).map((entry) => ({
          columns: (sqlite.pragma(`index_info(${entry.name})`) as Array<{
            name: string;
          }>).map((column) => column.name),
          unique: entry.unique,
        }));

      expect(indexes("guest_sessions")).toEqual(expect.arrayContaining([
        { columns: ["expires_at"], unique: 0 },
      ]));
      expect(indexes("rate_limit_windows")).toEqual(expect.arrayContaining([
        { columns: ["expires_at"], unique: 0 },
      ]));
    });
  });
});