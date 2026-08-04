import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
  responses,
} from "../../../db/schema";
import { createGuestTokenDigester } from "../../../lib/security";
import { appointmentSnapshotSchema } from "../contracts";
import { AppError } from "../http-errors";
import {
  createEnrollmentTestDatabase,
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
import { getAppointmentSnapshot } from "./snapshot";

const OTHER_USER_ID = "00000000-0000-4000-8000-000000000003";
const SESSION_TOKEN = Buffer.alloc(32, 0x51);
const TOKEN_DIGESTER = createGuestTokenDigester(Buffer.alloc(32, 0x61));

let database: EnrollmentTestDatabase;
let appointmentId: string;

beforeEach(() => {
  database = createEnrollmentTestDatabase();
  insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
  appointmentId = insertAppointment(database);
});

afterEach(() => database.close());

function addGuestAccess(participantId: string, expiresAt = TEST_NOW + 10_000): void {
  const tokenHash = TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN);
  database.connection.db.insert(guestSessions).values({
    tokenHash,
    createdAt: TEST_NOW - 1_000,
    expiresAt,
    lastSeenAt: TEST_NOW - 1_000,
  }).onConflictDoNothing().run();
  database.connection.db.insert(guestSessionAccess).values({
    sessionTokenHash: tokenHash,
    participantId,
    createdAt: TEST_NOW,
  }).run();
}

function addOption(creatorParticipantId: string, startDate: string): string {
  return database.connection.db.insert(appointmentOptions).values({
    appointmentId,
    creatorParticipantId,
    startDate,
    canonicalKey: `D:${startDate}`,
    createdAt: TEST_NOW,
  }).returning({ id: appointmentOptions.id }).get().id;
}
function snapshot(overrides: Partial<Parameters<typeof getAppointmentSnapshot>[1]> = {}) {
  return getAppointmentSnapshot(database.context, {
    publicId: PUBLIC_ID,
    identity: null,
    requestedParticipantId: null,
    guestSessionToken: null,
    ...overrides,
  }, TOKEN_DIGESTER);
}

describe("getAppointmentSnapshot", () => {
  it("returns the full ordered guest snapshot and auto-selects one linked participant", () => {
    const guestId = insertParticipant(database, appointmentId, "Guest");
    const laterId = insertParticipant(database, appointmentId, "Later");
    database.connection.db.update(participants).set({ createdAt: TEST_NOW + 1 })
      .where(eq(participants.id, laterId)).run();
    const secondOptionId = addOption(guestId, "2030-01-02");
    const firstOptionId = addOption(guestId, "2030-01-01");
    database.connection.db.insert(responses).values([
      { appointmentId, participantId: guestId, optionId: firstOptionId, value: "YES", updatedAt: TEST_NOW },
      { appointmentId, participantId: laterId, optionId: firstOptionId, value: "NO", updatedAt: TEST_NOW },
      { appointmentId, participantId: guestId, optionId: secondOptionId, value: "NO", updatedAt: TEST_NOW },
    ]).run();
    addGuestAccess(guestId);

    const result = snapshot({ guestSessionToken: SESSION_TOKEN.toString("base64url") });

    expect(result.participants.map(({ id }) => id)).toEqual([guestId, laterId]);
    expect(result.options.map(({ id }) => id)).toEqual([firstOptionId, secondOptionId]);
    expect(result.options[0]).toMatchObject({
      creatorParticipantId: guestId,
      yesCount: 1,
      noCount: 1,
      canDelete: true,
      responses: [
        { participantId: guestId, value: "YES" },
        { participantId: laterId, value: "NO" },
      ],
    });
    expect(result.viewer).toEqual({
      kind: "guest",
      activeParticipantId: guestId,
      accessibleParticipants: [{ id: guestId, displayName: "Guest" }],
      needsParticipantName: false,
      participantEnrollmentError: null,
      permissions: {
        canEditAppointment: false,
        canManageCoOrganizers: false,
        canDeleteAppointment: false,
        canFinalize: false,
        canReopen: false,
        canResetGuestLinks: false,
        canRespond: true,
        canSuggest: true,
      },
    });
    expect(appointmentSnapshotSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN_DIGESTER.digestSessionToken(SESSION_TOKEN).toString("hex"));
  });

  it("keeps multiple linked guest choices unselected and treats an inaccessible request as anonymous", () => {
    const firstId = insertParticipant(database, appointmentId, "First");
    const secondId = insertParticipant(database, appointmentId, "Second");
    const inaccessibleId = insertParticipant(database, appointmentId, "Inaccessible");
    database.connection.db.update(participants).set({ createdAt: TEST_NOW + 1 })
      .where(eq(participants.id, secondId)).run();
    addGuestAccess(firstId);
    addGuestAccess(secondId);

    const unselected = snapshot({ guestSessionToken: SESSION_TOKEN.toString("base64url") });
    const inaccessible = snapshot({
      guestSessionToken: SESSION_TOKEN.toString("base64url"),
      requestedParticipantId: inaccessibleId,
    });

    expect(unselected.viewer).toMatchObject({
      kind: "anonymous",
      activeParticipantId: null,
      accessibleParticipants: [
        { id: firstId, displayName: "First" },
        { id: secondId, displayName: "Second" },
      ],
    });
    expect(inaccessible.viewer).toEqual(unselected.viewer);
  });

  it("uses an authenticated linked participant and ignores the guest query", () => {
    insertUser(database, OTHER_USER_ID, "former@example.com", "Former");
    const linkedId = insertParticipant(database, appointmentId, "Former manager", OTHER_USER_ID);
    const guestId = insertParticipant(database, appointmentId, "Guest");
    addGuestAccess(guestId);
    const optionId = addOption(linkedId, "2030-01-01");

    const result = snapshot({
      identity: { userId: OTHER_USER_ID, email: "former@example.com", name: "Former" },
      requestedParticipantId: guestId,
      guestSessionToken: SESSION_TOKEN.toString("base64url"),
    });

    expect(result.viewer).toMatchObject({
      kind: "authenticated",
      activeParticipantId: linkedId,
      accessibleParticipants: [{ id: linkedId, displayName: "Former manager" }],
      permissions: {
        canEditAppointment: false,
        canRespond: true,
        canSuggest: true,
      },
    });
    expect(result.options.find(({ id }) => id === optionId)?.canDelete).toBe(true);
  });

  it("binds and enrolls a pending manager on access, then returns manager permissions", () => {
    const publish = vi.fn();
    database.close();
    database = createEnrollmentTestDatabase({ publish });
    insertUser(database, OWNER_USER_ID, "owner@example.com", "Owner");
    insertUser(database, MANAGER_USER_ID, "manager@example.com", "Manager Name");
    appointmentId = insertAppointment(database);
    insertManager(database, appointmentId, { userId: null, email: "manager@example.com" });

    const result = snapshot({
      identity: { userId: MANAGER_USER_ID, email: "MANAGER@example.com", name: "Manager Name" },
    });

    const manager = database.connection.db.select().from(appointmentManagers).get();
    expect(manager?.userId).toBe(MANAGER_USER_ID);
    expect(result.appointment.revision).toBe(2);
    expect(result.viewer).toMatchObject({
      kind: "authenticated",
      activeParticipantId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      needsParticipantName: false,
      participantEnrollmentError: null,
      permissions: {
        canEditAppointment: true,
        canManageCoOrganizers: false,
        canDeleteAppointment: false,
        canFinalize: true,
        canReopen: false,
        canResetGuestLinks: true,
        canRespond: true,
        canSuggest: true,
      },
    });
    expect(publish).toHaveBeenCalledOnce();
  });

  it("reports manager name conflicts without granting participant actions", () => {
    insertUser(database, MANAGER_USER_ID, "manager@example.com", "Taken");
    insertManager(database, appointmentId, { email: "manager@example.com" });
    insertParticipant(database, appointmentId, "Taken");

    const result = snapshot({
      identity: { userId: MANAGER_USER_ID, email: "manager@example.com", name: "Taken" },
    });

    expect(result.viewer).toMatchObject({
      kind: "authenticated",
      activeParticipantId: null,
      needsParticipantName: true,
      participantEnrollmentError: null,
      permissions: { canEditAppointment: true, canRespond: false, canSuggest: false },
    });
  });

  it("lets an unrelated signed-in user use linked guest access", () => {
    insertUser(database, OTHER_USER_ID, "visitor@example.com", "Visitor");
    const guestId = insertParticipant(database, appointmentId, "Guest");
    addGuestAccess(guestId);

    expect(snapshot({
      identity: { userId: OTHER_USER_ID, email: "visitor@example.com", name: "Visitor" },
      requestedParticipantId: guestId,
      guestSessionToken: SESSION_TOKEN.toString("base64url"),
    }).viewer).toMatchObject({ kind: "guest", activeParticipantId: guestId });
  });

  it("returns NOT_FOUND for an unknown appointment", () => {
    try {
      snapshot({ publicId: "zyxwvutsrqponmlkjihgfedc" });
      throw new Error("Expected getAppointmentSnapshot to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
