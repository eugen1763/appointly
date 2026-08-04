import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  type OptionStorageValues,
  toOptionStorageValues,
  validateOptionInputForStorage as validateSubmittedOption,
} from "./option-storage";

const now = 1_800_000_000_000;
const sameInstant = 1_801_234_567_890;

let schemaTemporaryDirectory: string | undefined;
let generatedSchemaSql: string;

beforeAll(() => {
  schemaTemporaryDirectory = mkdtempSync(join(tmpdir(), "appointly-task-12-schema-"));
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
    [join(process.cwd(), "node_modules/drizzle-kit/bin.cjs"), "generate", "--config", configPath, "--name", "task-12-option-storage"],
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

function createOptionDatabase(): Database.Database {
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
  sqlite.prepare(
    `INSERT INTO appointments (
      id, public_id, owner_user_id, title, description, type, status,
      option_limit, final_option_id, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "appointment-a",
    "0123456789abcdefghijklmn",
    "owner-user",
    "Planning",
    null,
    "DATE_TIME_RANGE",
    "ACTIVE",
    10,
    null,
    1,
    now,
    now,
  );
  sqlite.prepare(
    `INSERT INTO participants (
      id, appointment_id, user_id, display_name, normalized_name,
      edit_token_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("participant-a", "appointment-a", "owner-user", "Owner", "owner", null, now, now);

  return sqlite;
}

function insertOption(
  sqlite: Database.Database,
  id: string,
  values: OptionStorageValues,
): void {
  sqlite.prepare(
    `INSERT INTO appointment_options (
      id, appointment_id, creator_participant_id, start_date, end_date,
      start_at, end_at, canonical_key, created_at
    ) VALUES (
      @id, @appointmentId, @creatorParticipantId, @startDate, @endDate,
      @startAt, @endAt, @canonicalKey, @createdAt
    )`,
  ).run({
    id,
    appointmentId: "appointment-a",
    creatorParticipantId: "participant-a",
    createdAt: now,
    ...values,
  });
}

describe("strict submitted option validation", () => {
  it.each([
    ["first proleptic-Gregorian day", "0000-01-01"],
    ["year-zero leap day", "0000-02-29"],
    ["century leap day", "2000-02-29"],
    ["ordinary leap day", "2024-02-29"],
    ["last four-digit year day", "9999-12-31"],
  ])("accepts the %s without a server-zone conversion", (_name, startDate) => {
    expect(validateSubmittedOption({ kind: "DATE", startDate })).toEqual({
      success: true,
      values: {
        startDate,
        endDate: null,
        startAt: null,
        endAt: null,
        canonicalKey: `D:${startDate}`,
      },
    });
  });

  it.each([
    ["missing zero padding", "2024-2-09"],
    ["leading whitespace", " 2024-02-09"],
    ["trailing data", "2024-02-09T00:00:00.000Z"],
    ["non-leap century day", "1900-02-29"],
    ["day zero", "2024-01-00"],
    ["day past month end", "2024-04-31"],
    ["month past year end", "2024-13-01"],
  ])("rejects a date with %s at startDate", (_name, startDate) => {
    expect(validateSubmittedOption({ kind: "DATE", startDate })).toEqual({
      success: false,
      fieldErrors: {
        startDate: ["Use YYYY-MM-DD with a real calendar date."],
      },
    });
  });

  it.each([
    ["first four-digit instant", "0000-01-01T00:00:00.000Z"],
    ["leap instant", "2024-02-29T23:59:59.999Z"],
    ["last four-digit instant", "9999-12-31T23:59:59.999Z"],
  ])("accepts the canonical UTC %s", (_name, startAt) => {
    const result = validateSubmittedOption({ kind: "DATE_TIME", startAt });
    expect(result).toEqual({
      success: true,
      values: {
        startDate: null,
        endDate: null,
        startAt: Date.parse(startAt),
        endAt: null,
        canonicalKey: `T:${Date.parse(startAt)}`,
      },
    });
  });

  it.each([
    ["an offset", "2030-01-02T03:04:05.006+00:00"],
    ["missing milliseconds", "2030-01-02T03:04:05Z"],
    ["short milliseconds", "2030-01-02T03:04:05.06Z"],
    ["expanded year", "+002030-01-02T03:04:05.006Z"],
    ["impossible day", "2030-02-29T03:04:05.006Z"],
    ["normalized hour", "2030-01-02T24:00:00.000Z"],
    ["lowercase suffix", "2030-01-02T03:04:05.006z"],
    ["trailing data", "2030-01-02T03:04:05.006Zx"],
  ])("rejects canonical UTC text with %s at startAt", (_name, startAt) => {
    expect(validateSubmittedOption({ kind: "DATE_TIME", startAt })).toEqual({
      success: false,
      fieldErrors: {
        startAt: [
          "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
        ],
      },
    });
  });

  it("rejects a parser result outside safe integer milliseconds", () => {
    const parse = vi
      .spyOn(Date, "parse")
      .mockReturnValue(Number.MAX_SAFE_INTEGER + 1);
    try {
      expect(validateSubmittedOption({
        kind: "DATE_TIME",
        startAt: "2030-01-02T03:04:05.006Z",
      })).toEqual({
        success: false,
        fieldErrors: {
          startAt: [
            "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
          ],
        },
      });
    } finally {
      parse.mockRestore();
    }
  });

  it("allows equal inclusive date-range endpoints", () => {
    expect(validateSubmittedOption({
      kind: "DATE_RANGE",
      startDate: "2030-01-02",
      endDate: "2030-01-02",
    })).toEqual({
      success: true,
      values: {
        startDate: "2030-01-02",
        endDate: "2030-01-02",
        startAt: null,
        endAt: null,
        canonicalKey: "DR:2030-01-02/2030-01-02",
      },
    });
  });

  it("rejects a reversed date range at endDate", () => {
    expect(validateSubmittedOption({
      kind: "DATE_RANGE",
      startDate: "2030-01-03",
      endDate: "2030-01-02",
    })).toEqual({
      success: false,
      fieldErrors: {
        endDate: ["End date must be on or after start date."],
      },
    });
  });

  it.each([
    ["equal", "2030-01-02T03:04:05.006Z"],
    ["earlier", "2030-01-02T03:04:05.005Z"],
  ])("rejects a timed range with an %s end at endAt", (_name, endAt) => {
    expect(validateSubmittedOption({
      kind: "DATE_TIME_RANGE",
      startAt: "2030-01-02T03:04:05.006Z",
      endAt,
    })).toEqual({
      success: false,
      fieldErrors: {
        endAt: ["End date and time must be after start date and time."],
      },
    });
  });

  it("reports each invalid range endpoint on its own field", () => {
    expect(validateSubmittedOption({
      kind: "DATE_TIME_RANGE",
      startAt: "not-a-time",
      endAt: "also-not-a-time",
    })).toEqual({
      success: false,
      fieldErrors: {
        startAt: [
          "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
        ],
        endAt: [
          "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.",
        ],
      },
    });
  });

  it.each([
    {
      name: "date",
      option: { kind: "DATE" as const, startDate: "2000-01-01" },
    },
    {
      name: "date range",
      option: {
        kind: "DATE_RANGE" as const,
        startDate: "2000-01-01",
        endDate: "2000-01-02",
      },
    },
    {
      name: "timed instant",
      option: {
        kind: "DATE_TIME" as const,
        startAt: "2000-01-01T00:00:00.000Z",
      },
    },
    {
      name: "timed range",
      option: {
        kind: "DATE_TIME_RANGE" as const,
        startAt: "2000-01-01T00:00:00.000Z",
        endAt: "2000-01-01T00:00:00.001Z",
      },
    },
  ])(
    "keeps historical $name storage conversion free of expiry rules",
    ({ option }) => {
      expect(validateSubmittedOption(option).success).toBe(true);
    },
  );
});

describe("canonical option storage values", () => {
  it("builds the exact date key and retains the exact date text", () => {
    expect(toOptionStorageValues({
      kind: "DATE",
      startDate: "0001-02-03",
    })).toEqual({
      startDate: "0001-02-03",
      endDate: null,
      startAt: null,
      endAt: null,
      canonicalKey: "D:0001-02-03",
    });
  });

  it("builds the exact timed-instant key and column shape", () => {
    expect(toOptionStorageValues({
      kind: "DATE_TIME",
      startAt: sameInstant,
    })).toEqual({
      startDate: null,
      endDate: null,
      startAt: sameInstant,
      endAt: null,
      canonicalKey: `T:${sameInstant}`,
    });
  });

  it("builds the exact inclusive date-range key and allows equal endpoints", () => {
    expect(toOptionStorageValues({
      kind: "DATE_RANGE",
      startDate: "2026-08-03",
      endDate: "2026-08-03",
    })).toEqual({
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      startAt: null,
      endAt: null,
      canonicalKey: "DR:2026-08-03/2026-08-03",
    });
  });

  it("rejects a lexically reversed date range without parsing date text", () => {
    expect(() => toOptionStorageValues({
      kind: "DATE_RANGE",
      startDate: "2026-08-04",
      endDate: "2026-08-03",
    })).toThrow(RangeError);
  });

  it("builds the exact timed-range key and column shape", () => {
    expect(toOptionStorageValues({
      kind: "DATE_TIME_RANGE",
      startAt: sameInstant,
      endAt: sameInstant + 60_000,
    })).toEqual({
      startDate: null,
      endDate: null,
      startAt: sameInstant,
      endAt: sameInstant + 60_000,
      canonicalKey: `TR:${sameInstant}/${sameInstant + 60_000}`,
    });
  });

  it.each([
    ["end equal to its start", sameInstant],
    ["end before its start", sameInstant - 1],
  ])("rejects a timed range with its %s", (_case, endAt) => {
    expect(() => toOptionStorageValues({
      kind: "DATE_TIME_RANGE",
      startAt: sameInstant,
      endAt,
    })).toThrow(RangeError);
  });

  it.each([
    ["fractional", 1.5],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["not-a-number", Number.NaN],
    ["too large", Number.MAX_SAFE_INTEGER + 1],
    ["too small", Number.MIN_SAFE_INTEGER - 1],
  ])("rejects a %s timed instant", (_case, startAt) => {
    expect(() => toOptionStorageValues({ kind: "DATE_TIME", startAt })).toThrow(RangeError);
  });

  it("accepts both safe-integer boundaries", () => {
    expect(toOptionStorageValues({
      kind: "DATE_TIME",
      startAt: Number.MIN_SAFE_INTEGER,
    }).startAt).toBe(Number.MIN_SAFE_INTEGER);
    expect(toOptionStorageValues({
      kind: "DATE_TIME_RANGE",
      startAt: Number.MAX_SAFE_INTEGER - 1,
      endAt: Number.MAX_SAFE_INTEGER,
    }).endAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [
      "start",
      { startAt: Number.MIN_SAFE_INTEGER - 1, endAt: sameInstant },
    ],
    [
      "end",
      { startAt: sameInstant, endAt: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])("rejects an unsafe timed-range %s", (_field, range) => {
    expect(() => toOptionStorageValues({
      kind: "DATE_TIME_RANGE",
      ...range,
    })).toThrow(RangeError);
  });

  it("gives already-normalized submissions for the same instant one key", () => {
    const fromUtcClient = toOptionStorageValues({
      kind: "DATE_TIME",
      startAt: sameInstant,
    });
    const fromOffsetClient = toOptionStorageValues({
      kind: "DATE_TIME",
      startAt: sameInstant,
    });

    expect(fromUtcClient.canonicalKey).toBe(`T:${sameInstant}`);
    expect(fromOffsetClient.canonicalKey).toBe(fromUtcClient.canonicalKey);
  });

  it("retains date text and safe integer milliseconds through SQLite", () => {
    const sqlite = createOptionDatabase();
    try {
      insertOption(sqlite, "date-option", toOptionStorageValues({
        kind: "DATE",
        startDate: "0001-02-03",
      }));
      insertOption(sqlite, "time-option", toOptionStorageValues({
        kind: "DATE_TIME",
        startAt: Number.MAX_SAFE_INTEGER,
      }));

      expect(sqlite.prepare(
        `SELECT start_date AS startDate, end_date AS endDate,
                start_at AS startAt, end_at AS endAt, canonical_key AS canonicalKey
         FROM appointment_options ORDER BY id`,
      ).all()).toEqual([
        {
          startDate: "0001-02-03",
          endDate: null,
          startAt: null,
          endAt: null,
          canonicalKey: "D:0001-02-03",
        },
        {
          startDate: null,
          endDate: null,
          startAt: Number.MAX_SAFE_INTEGER,
          endAt: null,
          canonicalKey: `T:${Number.MAX_SAFE_INTEGER}`,
        },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("lets SQLite store overlaps but rejects an exact canonical duplicate", () => {
    const sqlite = createOptionDatabase();
    try {
      const first = toOptionStorageValues({
        kind: "DATE_RANGE",
        startDate: "2026-08-03",
        endDate: "2026-08-05",
      });
      const overlap = toOptionStorageValues({
        kind: "DATE_RANGE",
        startDate: "2026-08-04",
        endDate: "2026-08-06",
      });

      insertOption(sqlite, "first", first);
      insertOption(sqlite, "overlap", overlap);

      expect(() => insertOption(sqlite, "duplicate", first)).toThrow(
        /UNIQUE constraint failed: appointment_options.appointment_id, appointment_options.canonical_key/,
      );
      expect(sqlite.prepare("SELECT count(*) FROM appointment_options").pluck().get()).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it("lets SQLite reject a second submission for the same timed instant", () => {
    const sqlite = createOptionDatabase();
    try {
      const fromUtcClient = toOptionStorageValues({ kind: "DATE_TIME", startAt: sameInstant });
      const fromOffsetClient = toOptionStorageValues({ kind: "DATE_TIME", startAt: sameInstant });

      insertOption(sqlite, "utc", fromUtcClient);
      expect(() => insertOption(sqlite, "offset", fromOffsetClient)).toThrow(
        /UNIQUE constraint failed: appointment_options.appointment_id, appointment_options.canonical_key/,
      );
    } finally {
      sqlite.close();
    }
  });
});
