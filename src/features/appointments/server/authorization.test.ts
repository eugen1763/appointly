import { describe, expect, it } from "vitest";

import {
  assertAppointmentDeletionAuthorized,
  canDeleteOwnOption,
  deriveManagerPermissions,
} from "./authorization";

describe("deriveManagerPermissions", () => {
  it.each([
    ["ACTIVE", "OWNER", null, [true, true, true, true, false, true, false, false]],
    ["ACTIVE", "OWNER", "participant-1", [true, true, true, true, false, true, true, true]],
    ["ACTIVE", "COORGANIZER", null, [true, false, false, true, false, true, false, false]],
    ["ACTIVE", "COORGANIZER", "participant-1", [true, false, false, true, false, true, true, true]],
    ["FINALIZED", "OWNER", null, [false, false, true, false, true, false, false, false]],
    ["FINALIZED", "OWNER", "participant-1", [false, false, true, false, true, false, false, false]],
    ["FINALIZED", "COORGANIZER", null, [false, false, false, false, true, false, false, false]],
    ["FINALIZED", "COORGANIZER", "participant-1", [false, false, false, false, true, false, false, false]],
  ] as const)(
    "sets every permission for %s %s with participant %s",
    (status, managerRole, participantId, expected) => {
      expect(Object.values(deriveManagerPermissions({
        managerRole,
        participantId,
        status,
      }))).toEqual(expected);
    },
  );
});

describe("assertAppointmentDeletionAuthorized", () => {
  it("allows the owner only when the exact title is supplied", () => {
    expect(() => assertAppointmentDeletionAuthorized({
      managerRole: "OWNER",
      appointmentTitle: "Quarterly Planning",
      confirmationTitle: "Quarterly Planning",
    })).not.toThrow();

    for (const confirmationTitle of [
      "quarterly planning",
      " Quarterly Planning",
      "Quarterly Planning ",
    ]) {
      expect(() => assertAppointmentDeletionAuthorized({
        managerRole: "OWNER",
        appointmentTitle: "Quarterly Planning",
        confirmationTitle,
      })).toThrow(expect.objectContaining({
        code: "TITLE_CONFIRMATION_MISMATCH",
      }));
    }
  });

  it("rejects a co-organizer even with the exact title", () => {
    expect(() => assertAppointmentDeletionAuthorized({
      managerRole: "COORGANIZER",
      appointmentTitle: "Quarterly Planning",
      confirmationTitle: "Quarterly Planning",
    })).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});

describe("canDeleteOwnOption", () => {
  it("requires an active appointment, enrollment, and matching option creator", () => {
    expect(canDeleteOwnOption({
      status: "ACTIVE",
      activeParticipantId: "participant-1",
      creatorParticipantId: "participant-1",
    })).toBe(true);
    expect(canDeleteOwnOption({
      status: "ACTIVE",
      activeParticipantId: null,
      creatorParticipantId: "participant-1",
    })).toBe(false);
    expect(canDeleteOwnOption({
      status: "ACTIVE",
      activeParticipantId: "participant-2",
      creatorParticipantId: "participant-1",
    })).toBe(false);
    expect(canDeleteOwnOption({
      status: "FINALIZED",
      activeParticipantId: "participant-1",
      creatorParticipantId: "participant-1",
    })).toBe(false);
  });
});
