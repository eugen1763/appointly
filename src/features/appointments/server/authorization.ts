import { and, eq } from "drizzle-orm";

import {
  guestSessionAccess,
  participants,
} from "../../../db/schema";
import type { GuestTokenDigester } from "../../../lib/security";
import type { AppointmentSnapshot } from "../contracts";
import { AppError } from "../http-errors";
import { resolveValidGuestSession } from "./guest-session";
import type { TransactionContext } from "./service-context";

type ManagerRole = "OWNER" | "COORGANIZER";
type AppointmentStatus = "ACTIVE" | "FINALIZED";
type ViewerPermissions = AppointmentSnapshot["viewer"]["permissions"];

export interface DeriveManagerPermissionsInput {
  readonly managerRole: ManagerRole;
  readonly participantId: string | null;
  readonly status: AppointmentStatus;
}

export function deriveManagerPermissions(
  input: DeriveManagerPermissionsInput,
): ViewerPermissions {
  const isActive = input.status === "ACTIVE";
  const isOwner = input.managerRole === "OWNER";
  const isParticipant = input.participantId !== null;

  return {
    canEditAppointment: isActive,
    canManageCoOrganizers: isActive && isOwner,
    canDeleteAppointment: isOwner,
    canFinalize: isActive,
    canReopen: !isActive,
    canResetGuestLinks: isActive,
    canRespond: isActive && isParticipant,
    canSuggest: isActive && isParticipant,
  };
}

export interface ParticipantActorIdentity {
  readonly userId: string;
}

export interface ResolveParticipantActorInput {
  readonly appointmentId: string;
  readonly participantId: string;
  readonly identity: ParticipantActorIdentity | null;
  readonly guestSessionToken: string | null;
  readonly now: number;
}
export type ResolvedParticipantActor =
  | {
      readonly kind: "authenticated";
      readonly participantId: string;
      readonly rateActor: { readonly kind: "user"; readonly id: string };
    }
  | {
      readonly kind: "guest";
      readonly participantId: string;
      readonly rateActor: { readonly kind: "participant"; readonly id: string };
    };

function participantAccessRequired(): AppError {
  return new AppError("FORBIDDEN", "Participant access is required.");
}

export function resolveParticipantActor(
  context: TransactionContext,
  input: ResolveParticipantActorInput,
  tokenDigester: GuestTokenDigester,
): ResolvedParticipantActor {
  if (input.identity !== null) {
    const linkedParticipant = context.db.select({ id: participants.id })
      .from(participants)
      .where(and(
        eq(participants.appointmentId, input.appointmentId),
        eq(participants.userId, input.identity.userId),
      ))
      .get();
    if (linkedParticipant !== undefined) {
      if (linkedParticipant.id !== input.participantId) {
        throw participantAccessRequired();
      }
      return {
        kind: "authenticated",
        participantId: linkedParticipant.id,
        rateActor: { kind: "user", id: input.identity.userId },
      };
    }
  }

  const session = resolveValidGuestSession(
    context,
    input.guestSessionToken,
    input.now,
    tokenDigester,
  );
  if (session === null) throw participantAccessRequired();

  const access = context.db.select({ participantId: participants.id })
    .from(guestSessionAccess)
    .innerJoin(
      participants,
      eq(guestSessionAccess.participantId, participants.id),
    )
    .where(and(
      eq(guestSessionAccess.sessionTokenHash, session.tokenHash),
      eq(participants.appointmentId, input.appointmentId),
      eq(participants.id, input.participantId),
    ))
    .get();
  if (access === undefined) throw participantAccessRequired();
  return {
    kind: "guest",
    participantId: access.participantId,
    rateActor: { kind: "participant", id: access.participantId },
  };
}

export function assertCanUpdateAppointmentDetails(
  status: AppointmentStatus,
): void {
  if (status === "FINALIZED") {
    throw new AppError(
      "APPOINTMENT_FINALIZED",
      "Reopen the appointment before changing appointment details.",
    );
  }
}

export interface AppointmentDeletionAuthorizationInput {
  readonly managerRole: ManagerRole;
  readonly appointmentTitle: string;
  readonly confirmationTitle: string;
}

export function assertAppointmentDeletionAuthorized(
  input: AppointmentDeletionAuthorizationInput,
): void {
  if (input.managerRole !== "OWNER") {
    throw new AppError(
      "FORBIDDEN",
      "Only the appointment owner can delete this appointment.",
    );
  }
  if (input.confirmationTitle !== input.appointmentTitle) {
    throw new AppError(
      "TITLE_CONFIRMATION_MISMATCH",
      "Enter the exact appointment title to confirm deletion.",
    );
  }
}

export interface CanDeleteOwnOptionInput {
  readonly status: AppointmentStatus;
  readonly activeParticipantId: string | null;
  readonly creatorParticipantId: string;
}

export function canDeleteOwnOption(input: CanDeleteOwnOptionInput): boolean {
  return input.status === "ACTIVE"
    && input.activeParticipantId !== null
    && input.activeParticipantId === input.creatorParticipantId;
}
