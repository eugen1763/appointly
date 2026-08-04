import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  blob,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth-schema";

const uuidPrimaryKey = (name: string) =>
  text(name)
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const appointments = sqliteTable(
  "appointments",
  {
    id: uuidPrimaryKey("id"),
    publicId: text("public_id").notNull().unique(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type", {
      enum: ["DATE", "DATE_TIME", "DATE_RANGE", "DATE_TIME_RANGE"],
    }).notNull(),
    status: text("status", { enum: ["ACTIVE", "FINALIZED"] }).notNull(),
    optionLimit: integer("option_limit").default(10).notNull(),
    finalOptionId: text("final_option_id").references(
      (): AnySQLiteColumn => appointmentOptions.id,
      { onDelete: "set null" },
    ),
    revision: integer("revision").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("appointments_id_nonempty", sql`length(${table.id}) > 0`),
    check(
      "appointments_public_id_format",
      sql`length(${table.publicId}) = 24
        AND ${table.publicId} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check("appointments_owner_user_id_nonempty", sql`length(${table.ownerUserId}) > 0`),
    check("appointments_title_length", sql`length(${table.title}) BETWEEN 1 AND 120`),
    check(
      "appointments_description_length",
      sql`${table.description} IS NULL OR length(${table.description}) <= 2000`,
    ),
    check(
      "appointments_type_values",
      sql`${table.type} IN ('DATE', 'DATE_TIME', 'DATE_RANGE', 'DATE_TIME_RANGE')`,
    ),
    check(
      "appointments_status_values",
      sql`${table.status} IN ('ACTIVE', 'FINALIZED')`,
    ),
    check(
      "appointments_option_limit_bounds",
      sql`typeof(${table.optionLimit}) = 'integer'
        AND ${table.optionLimit} BETWEEN 1 AND 100`,
    ),
    check(
      "appointments_revision_minimum",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 1`,
    ),
    check(
      "appointments_created_at_integer",
      sql`typeof(${table.createdAt}) = 'integer'`,
    ),
    check(
      "appointments_updated_at_integer",
      sql`typeof(${table.updatedAt}) = 'integer'`,
    ),
    check(
      "appointments_status_final_option_pair",
      sql`(
        ${table.status} = 'ACTIVE' AND ${table.finalOptionId} IS NULL
      ) OR (
        ${table.status} = 'FINALIZED' AND ${table.finalOptionId} IS NOT NULL
      )`,
    ),
    index("appointments_owner_user_lookup").on(table.ownerUserId),
    index("appointments_final_option_lookup").on(table.finalOptionId),
  ],
);

export const appointmentManagers = sqliteTable(
  "appointment_managers",
  {
    id: uuidPrimaryKey("id"),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    emailNormalized: text("email_normalized").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    role: text("role", { enum: ["OWNER", "COORGANIZER"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "appointment_managers_role_values",
      sql`${table.role} IN ('OWNER', 'COORGANIZER')`,
    ),
    uniqueIndex("appointment_managers_appointment_email_unique").on(
      table.appointmentId,
      table.emailNormalized,
    ),
    uniqueIndex("appointment_managers_appointment_user_unique")
      .on(table.appointmentId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    uniqueIndex("appointment_managers_owner_unique")
      .on(table.appointmentId)
      .where(sql`${table.role} = 'OWNER'`),
    index("appointment_managers_email_lookup").on(table.emailNormalized),
    index("appointment_managers_user_lookup").on(table.userId),
  ],
);

export const participants = sqliteTable(
  "participants",
  {
    id: uuidPrimaryKey("id"),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    editTokenHash: blob("edit_token_hash", { mode: "buffer" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check(
      "participants_display_name_length",
      sql`length(${table.displayName}) BETWEEN 1 AND 80`,
    ),
    check(
      "participants_normalized_name_nonempty",
      sql`length(${table.normalizedName}) > 0`,
    ),
    check(
      "participants_edit_token_hash_blob_length",
      sql`${table.editTokenHash} IS NULL OR (
        typeof(${table.editTokenHash}) = 'blob'
        AND length(${table.editTokenHash}) = 32
      )`,
    ),
    uniqueIndex("participants_appointment_id_unique").on(
      table.appointmentId,
      table.id,
    ),
    uniqueIndex("participants_appointment_name_unique").on(
      table.appointmentId,
      table.normalizedName,
    ),
    uniqueIndex("participants_appointment_user_unique")
      .on(table.appointmentId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("participants_name_lookup").on(table.normalizedName),
    index("participants_user_lookup").on(table.userId),
  ],
);

export const appointmentOptions = sqliteTable(
  "appointment_options",
  {
    id: uuidPrimaryKey("id"),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    creatorParticipantId: text("creator_participant_id").notNull(),
    startDate: text("start_date"),
    endDate: text("end_date"),
    startAt: integer("start_at"),
    endAt: integer("end_at"),
    canonicalKey: text("canonical_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "appointment_options_shape",
      sql`(
        ${table.startDate} IS NOT NULL
        AND ${table.endDate} IS NULL
        AND ${table.startAt} IS NULL
        AND ${table.endAt} IS NULL
      ) OR (
        ${table.startDate} IS NOT NULL
        AND ${table.endDate} IS NOT NULL
        AND ${table.endDate} >= ${table.startDate}
        AND ${table.startAt} IS NULL
        AND ${table.endAt} IS NULL
      ) OR (
        ${table.startDate} IS NULL
        AND ${table.endDate} IS NULL
        AND ${table.startAt} IS NOT NULL
        AND ${table.endAt} IS NULL
      ) OR (
        ${table.startDate} IS NULL
        AND ${table.endDate} IS NULL
        AND ${table.startAt} IS NOT NULL
        AND ${table.endAt} IS NOT NULL
        AND ${table.endAt} > ${table.startAt}
      )`,
    ),
    uniqueIndex("appointment_options_appointment_id_unique").on(
      table.appointmentId,
      table.id,
    ),
    uniqueIndex("appointment_options_appointment_canonical_key_unique").on(
      table.appointmentId,
      table.canonicalKey,
    ),
    foreignKey({
      columns: [table.appointmentId, table.creatorParticipantId],
      foreignColumns: [participants.appointmentId, participants.id],
      name: "appointment_options_creator_participant_fk",
    }).onDelete("cascade"),
    index("appointment_options_creator_lookup").on(
      table.appointmentId,
      table.creatorParticipantId,
    ),
    index("appointment_options_order").on(
      table.appointmentId,
      table.startDate,
      table.startAt,
      table.createdAt,
      table.id,
    ),
  ],
);

export const responses = sqliteTable(
  "responses",
  {
    appointmentId: text("appointment_id").notNull(),
    participantId: text("participant_id").notNull(),
    optionId: text("option_id").notNull(),
    value: text("value", { enum: ["YES", "NO"] }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("responses_value_values", sql`${table.value} IN ('YES', 'NO')`),
    primaryKey({
      columns: [table.appointmentId, table.participantId, table.optionId],
      name: "responses_appointment_participant_option_pk",
    }),
    foreignKey({
      columns: [table.appointmentId, table.participantId],
      foreignColumns: [participants.appointmentId, participants.id],
      name: "responses_participant_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.appointmentId, table.optionId],
      foreignColumns: [appointmentOptions.appointmentId, appointmentOptions.id],
      name: "responses_option_fk",
    }).onDelete("cascade"),
    index("responses_option_lookup").on(table.appointmentId, table.optionId),
    index("responses_participant_lookup").on(
      table.appointmentId,
      table.participantId,
    ),
  ],
);

export const guestSessions = sqliteTable(
  "guest_sessions",
  {
    tokenHash: blob("token_hash", { mode: "buffer" }).notNull().primaryKey(),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    check(
      "guest_sessions_token_hash_blob_32",
      sql`typeof(${table.tokenHash}) = 'blob' AND length(${table.tokenHash}) = 32`,
    ),
    check(
      "guest_sessions_expiry_order",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    index("guest_sessions_expiry_lookup").on(table.expiresAt),
  ],
);

export const guestSessionAccess = sqliteTable(
  "guest_session_access",
  {
    sessionTokenHash: blob("session_token_hash", { mode: "buffer" }).notNull(),
    participantId: text("participant_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    check(
      "guest_session_access_token_hash_blob_32",
      sql`typeof(${table.sessionTokenHash}) = 'blob' AND length(${table.sessionTokenHash}) = 32`,
    ),
    primaryKey({
      columns: [table.sessionTokenHash, table.participantId],
      name: "guest_session_access_session_participant_pk",
    }),
    foreignKey({
      columns: [table.sessionTokenHash],
      foreignColumns: [guestSessions.tokenHash],
      name: "guest_session_access_session_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.participantId],
      foreignColumns: [participants.id],
      name: "guest_session_access_participant_fk",
    }).onDelete("cascade"),
    index("guest_session_access_participant_lookup").on(table.participantId),
  ],
);

export const rateLimitWindows = sqliteTable(
  "rate_limit_windows",
  {
    key: blob("key", { mode: "buffer" }).notNull().primaryKey(),
    count: integer("count").notNull(),
    windowStartedAt: integer("window_started_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    check(
      "rate_limit_windows_key_blob_32",
      sql`typeof(${table.key}) = 'blob' AND length(${table.key}) = 32`,
    ),
    check(
      "rate_limit_windows_count_nonnegative",
      sql`${table.count} >= 0`,
    ),
    check(
      "rate_limit_windows_expiry_order",
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
    index("rate_limit_windows_expiry_lookup").on(table.expiresAt),
  ],
);
