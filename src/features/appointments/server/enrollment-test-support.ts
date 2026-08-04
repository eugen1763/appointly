import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { user } from "../../../db/auth-schema";
import { createDatabaseConnection, type DatabaseConnection } from "../../../db/connection";
import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
} from "../../../db/schema";
import type { EventPublisher, ServiceContext } from "./service-context";

export const TEST_NOW = 1_800_000_000_000;
export const OWNER_USER_ID = "00000000-0000-4000-8000-000000000001";
export const MANAGER_USER_ID = "00000000-0000-4000-8000-000000000002";
export const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";

export interface EnrollmentTestDatabase {
  readonly connection: DatabaseConnection;
  readonly context: ServiceContext;
  close(): void;
}

export function createEnrollmentTestDatabase(
  eventPublisher: EventPublisher = { publish() {} },
): EnrollmentTestDatabase {
  const directory = mkdtempSync(join(tmpdir(), "appointly-enrollment-"));
  const connection = createDatabaseConnection(join(directory, "test.sqlite"));
  migrate(connection.db, { migrationsFolder: join(process.cwd(), "drizzle") });

  const context: ServiceContext = {
    ...connection,
    clock: { now: () => TEST_NOW },
    tokenFactory: () => Buffer.alloc(32, 0x19),
    eventPublisher,
  };

  return {
    connection,
    context,
    close() {
      connection.sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function insertUser(
  database: EnrollmentTestDatabase,
  id: string,
  email: string,
  name: string,
): void {
  database.connection.db.insert(user).values({
    id,
    email,
    name,
    emailVerified: true,
    createdAt: new Date(TEST_NOW),
    updatedAt: new Date(TEST_NOW),
  }).run();
}

export function insertAppointment(
  database: EnrollmentTestDatabase,
  ownerUserId = OWNER_USER_ID,
  publicId = PUBLIC_ID,
): string {
  const [appointment] = database.connection.db.insert(appointments).values({
    publicId,
    ownerUserId,
    title: "Planning",
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 10,
    finalOptionId: null,
    revision: 1,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  }).returning({ id: appointments.id }).all();
  if (!appointment) throw new Error("Fixture appointment was not inserted");
  return appointment.id;
}

export interface InsertManagerOptions {
  readonly userId?: string | null;
  readonly email?: string;
  readonly role?: "OWNER" | "COORGANIZER";
  readonly createdAt?: number;
}

export function insertManager(
  database: EnrollmentTestDatabase,
  appointmentId: string,
  userIdOrOptions: string | null | InsertManagerOptions = MANAGER_USER_ID,
): string {
  const options = typeof userIdOrOptions === "object" && userIdOrOptions !== null
    ? userIdOrOptions
    : { userId: userIdOrOptions };
  const manager = database.connection.db.insert(appointmentManagers).values({
    appointmentId,
    emailNormalized: options.email ?? "manager@example.com",
    userId: options.userId === undefined ? MANAGER_USER_ID : options.userId,
    role: options.role ?? "COORGANIZER",
    createdAt: options.createdAt ?? TEST_NOW,
  }).returning({ id: appointmentManagers.id }).get();
  return manager.id;
}

export function insertParticipant(
  database: EnrollmentTestDatabase,
  appointmentId: string,
  displayName: string,
  userId: string | null = null,
): string {
  const [participant] = database.connection.db.insert(participants).values({
    appointmentId,
    userId,
    displayName,
    normalizedName: displayName.toLowerCase(),
    editTokenHash: null,
    createdAt: TEST_NOW,
    updatedAt: TEST_NOW,
  }).returning({ id: participants.id }).all();
  if (!participant) throw new Error("Fixture participant was not inserted");
  return participant.id;
}

export function finalizeAppointment(
  database: EnrollmentTestDatabase,
  appointmentId: string,
  creatorParticipantId: string,
): void {
  const [option] = database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId,
    startDate: "2030-01-01",
    endDate: null,
    startAt: null,
    endAt: null,
    canonicalKey: "D:2030-01-01",
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).all();
  if (!option) throw new Error("Fixture option was not inserted");
  database.connection.db.update(appointments).set({
    status: "FINALIZED",
    finalOptionId: option.id,
  }).run();
}
