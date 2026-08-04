import { and, asc, eq, isNull, or } from "drizzle-orm";

import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
import { normalizeEmail } from "../../../lib/email";
import type { GuestTokenDigester } from "../../../lib/security";
import type { AppointmentSnapshot, OptionValue } from "../contracts";
import { AppError } from "../http-errors";
import {
  canDeleteOwnOption,
  deriveManagerPermissions,
} from "./authorization";
import { resolveLinkedGuestAccess } from "./guest-session";
import { ensureBoundManagerParticipant } from "./management";
import type { ServiceContext } from "./service-context";

export interface PublicParticipant {
  readonly id: string;
  readonly displayName: string;
}

export interface PublicResponse {
  readonly participantId: string;
  readonly value: "YES" | "NO";
}

export type PublicOption = (OptionValue & {
  readonly id: string;
  readonly responses: readonly PublicResponse[];
});

export interface PublicAppointment {
  readonly appointment: {
    readonly publicId: string;
    readonly title: string;
    readonly description: string | null;
    readonly type: "DATE" | "DATE_TIME" | "DATE_RANGE" | "DATE_TIME_RANGE";
    readonly status: "ACTIVE" | "FINALIZED";
    readonly optionLimit: number;
    readonly finalOptionId: string | null;
    readonly revision: number;
  };
  readonly participants: readonly PublicParticipant[];
  readonly options: readonly PublicOption[];
}

type AppointmentType = PublicAppointment["appointment"]["type"];

export interface PublicOptionRow {
  readonly id: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly startAt: number | null;
  readonly endAt: number | null;
}

function required<Value>(value: Value | null, field: string): Value {
  if (value === null) {
    throw new Error(`Stored appointment option is missing ${field}`);
  }
  return value;
}

/**
 * Exported so the dashboard tally turns stored option rows into option values
 * through the same code path the snapshot uses, rather than a second projection
 * that could drift from it.
 */
export function projectOption(
  type: AppointmentType,
  row: PublicOptionRow,
  optionResponses: readonly PublicResponse[],
): PublicOption {
  const common = { id: row.id, responses: optionResponses };
  switch (type) {
    case "DATE":
      return {
        ...common,
        kind: type,
        startDate: required(row.startDate, "startDate"),
      };
    case "DATE_TIME":
      return {
        ...common,
        kind: type,
        startAt: required(row.startAt, "startAt"),
      };
    case "DATE_RANGE":
      return {
        ...common,
        kind: type,
        startDate: required(row.startDate, "startDate"),
        endDate: required(row.endDate, "endDate"),
      };
    case "DATE_TIME_RANGE":
      return {
        ...common,
        kind: type,
        startAt: required(row.startAt, "startAt"),
        endAt: required(row.endAt, "endAt"),
      };
  }
}

export function getPublicAppointment(
  context: ServiceContext,
  publicId: string,
): PublicAppointment | null {
  const appointment = context.db.select({
    id: appointments.id,
    publicId: appointments.publicId,
    title: appointments.title,
    description: appointments.description,
    type: appointments.type,
    status: appointments.status,
    optionLimit: appointments.optionLimit,
    finalOptionId: appointments.finalOptionId,
    revision: appointments.revision,
  }).from(appointments)
    .where(eq(appointments.publicId, publicId))
    .get();
  if (!appointment) return null;

  const publicParticipants = context.db.select({
    id: participants.id,
    displayName: participants.displayName,
  }).from(participants)
    .where(eq(participants.appointmentId, appointment.id))
    .orderBy(asc(participants.createdAt), asc(participants.id))
    .all();

  const startColumn = appointment.type === "DATE" || appointment.type === "DATE_RANGE"
    ? appointmentOptions.startDate
    : appointmentOptions.startAt;
  const optionRows = context.db.select({
    id: appointmentOptions.id,
    startDate: appointmentOptions.startDate,
    endDate: appointmentOptions.endDate,
    startAt: appointmentOptions.startAt,
    endAt: appointmentOptions.endAt,
  }).from(appointmentOptions)
    .where(eq(appointmentOptions.appointmentId, appointment.id))
    .orderBy(
      asc(startColumn),
      asc(appointmentOptions.createdAt),
      asc(appointmentOptions.id),
    )
    .all();

  const responseRows = context.db.select({
    optionId: responses.optionId,
    participantId: responses.participantId,
    value: responses.value,
  }).from(responses)
    .where(eq(responses.appointmentId, appointment.id))
    .all();
  const responsesByOption = new Map<string, Map<string, "YES" | "NO">>();
  for (const response of responseRows) {
    const optionResponses = responsesByOption.get(response.optionId)
      ?? new Map<string, "YES" | "NO">();
    optionResponses.set(response.participantId, response.value);
    responsesByOption.set(response.optionId, optionResponses);
  }

  const publicOptions = optionRows.map((option) => {
    const optionResponses = responsesByOption.get(option.id);
    const orderedResponses = publicParticipants.flatMap((participant) => {
      const value = optionResponses?.get(participant.id);
      return value ? [{ participantId: participant.id, value }] : [];
    });
    return projectOption(appointment.type, option, orderedResponses);
  });

  return {
    appointment: {
      publicId: appointment.publicId,
      title: appointment.title,
      description: appointment.description,
      type: appointment.type,
      status: appointment.status,
      optionLimit: appointment.optionLimit,
      finalOptionId: appointment.finalOptionId,
      revision: appointment.revision,
    },
    participants: publicParticipants,
    options: publicOptions,
  };
}

export interface SnapshotIdentity {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
}

export interface GetAppointmentSnapshotInput {
  readonly publicId: string;
  readonly identity: SnapshotIdentity | null;
  readonly requestedParticipantId: string | null;
  readonly guestSessionToken: string | null;
}

interface SnapshotViewerResolution {
  readonly kind: "authenticated" | "guest" | "anonymous";
  readonly activeParticipantId: string | null;
  readonly accessibleParticipants: Array<{ id: string; displayName: string }>;
  readonly managerRole: "OWNER" | "COORGANIZER" | null;
  readonly needsParticipantName: boolean;
  readonly participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED" | null;
}

function findParticipantForUser(
  context: ServiceContext,
  appointmentId: string,
  userId: string,
): { id: string; displayName: string } | null {
  return context.db.select({
    id: participants.id,
    displayName: participants.displayName,
  }).from(participants).where(and(
    eq(participants.appointmentId, appointmentId),
    eq(participants.userId, userId),
  )).get() ?? null;
}

function resolveSnapshotViewer(
  context: ServiceContext,
  appointmentId: string,
  input: GetAppointmentSnapshotInput,
  tokenDigester: GuestTokenDigester,
): SnapshotViewerResolution {
  if (input.identity !== null) {
    const normalizedEmail = normalizeEmail(input.identity.email);
    const managerCandidate = context.db.select({ id: appointmentManagers.id })
      .from(appointmentManagers)
      .where(and(
        eq(appointmentManagers.appointmentId, appointmentId),
        or(
          eq(appointmentManagers.userId, input.identity.userId),
          and(
            eq(appointmentManagers.emailNormalized, normalizedEmail),
            isNull(appointmentManagers.userId),
          ),
        ),
      ))
      .get();
    if (managerCandidate !== undefined) {
      const enrollment = ensureBoundManagerParticipant(context, {
        publicId: input.publicId,
        userId: input.identity.userId,
        email: input.identity.email,
        googleName: input.identity.name,
      });
      const managerRole = context.db.select({ role: appointmentManagers.role })
        .from(appointmentManagers)
        .where(and(
          eq(appointmentManagers.appointmentId, appointmentId),
          eq(appointmentManagers.userId, input.identity.userId),
        ))
        .get()?.role;
      if (managerRole === undefined) {
        throw new Error("Manager binding did not produce manager access");
      }
      const linkedParticipant = enrollment.participantId === null
        ? null
        : findParticipantForUser(context, appointmentId, input.identity.userId);
      return {
        kind: "authenticated",
        activeParticipantId: enrollment.participantId,
        accessibleParticipants: linkedParticipant === null ? [] : [linkedParticipant],
        managerRole,
        needsParticipantName: enrollment.needsParticipantName,
        participantEnrollmentError: enrollment.participantEnrollmentError,
      };
    }

    const linkedParticipant = findParticipantForUser(
      context,
      appointmentId,
      input.identity.userId,
    );
    if (linkedParticipant !== null) {
      return {
        kind: "authenticated",
        activeParticipantId: linkedParticipant.id,
        accessibleParticipants: [linkedParticipant],
        managerRole: null,
        needsParticipantName: false,
        participantEnrollmentError: null,
      };
    }
  }

  const accessibleParticipants = resolveLinkedGuestAccess(
    context,
    input.publicId,
    input.guestSessionToken,
    tokenDigester,
  );
  const requestedParticipant = input.requestedParticipantId === null
    ? null
    : accessibleParticipants.find(({ participantId }) => (
        participantId === input.requestedParticipantId
      )) ?? null;
  const activeParticipant = requestedParticipant
    ?? (input.requestedParticipantId === null && accessibleParticipants.length === 1
      ? accessibleParticipants[0] ?? null
      : null);
  return {
    kind: activeParticipant === null ? "anonymous" : "guest",
    activeParticipantId: activeParticipant?.participantId ?? null,
    accessibleParticipants: accessibleParticipants.map(({ participantId, displayName }) => ({
      id: participantId,
      displayName,
    })),
    managerRole: null,
    needsParticipantName: false,
    participantEnrollmentError: null,
  };
}

function participantPermissions(
  status: "ACTIVE" | "FINALIZED",
  participantId: string | null,
): AppointmentSnapshot["viewer"]["permissions"] {
  const canParticipate = status === "ACTIVE" && participantId !== null;
  return {
    canEditAppointment: false,
    canManageCoOrganizers: false,
    canDeleteAppointment: false,
    canFinalize: false,
    canReopen: false,
    canResetGuestLinks: false,
    canRespond: canParticipate,
    canSuggest: canParticipate,
  };
}

function executeGetAppointmentSnapshot(
  context: ServiceContext,
  input: GetAppointmentSnapshotInput,
  tokenDigester: GuestTokenDigester,
): AppointmentSnapshot {
  const appointmentRecord = context.db.select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.publicId, input.publicId))
    .get();
  if (appointmentRecord === undefined) {
    throw new AppError("NOT_FOUND", "Appointment was not found.");
  }
  const viewer = resolveSnapshotViewer(
    context,
    appointmentRecord.id,
    input,
    tokenDigester,
  );

  return context.sqlite.transaction((): AppointmentSnapshot => {
    const publicAppointment = getPublicAppointment(context, input.publicId);
    if (publicAppointment === null) {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    }
    const creatorRows = context.db.select({
      optionId: appointmentOptions.id,
      creatorParticipantId: appointmentOptions.creatorParticipantId,
    }).from(appointmentOptions)
      .where(eq(appointmentOptions.appointmentId, appointmentRecord.id))
      .all();
    const creatorByOption = new Map(
      creatorRows.map(({ optionId, creatorParticipantId }) => (
        [optionId, creatorParticipantId] as const
      )),
    );
    const permissions = viewer.managerRole === null
      ? participantPermissions(
          publicAppointment.appointment.status,
          viewer.activeParticipantId,
        )
      : deriveManagerPermissions({
          managerRole: viewer.managerRole,
          participantId: viewer.activeParticipantId,
          status: publicAppointment.appointment.status,
        });

    const options = publicAppointment.options.map((option) => {
      const creatorParticipantId = creatorByOption.get(option.id);
      if (creatorParticipantId === undefined) {
        throw new Error("Stored appointment option has no creator");
      }
      let yesCount = 0;
      let noCount = 0;
      for (const response of option.responses) {
        if (response.value === "YES") yesCount += 1;
        else noCount += 1;
      }
      return {
        ...option,
        creatorParticipantId,
        yesCount,
        noCount,
        canDelete: canDeleteOwnOption({
          status: publicAppointment.appointment.status,
          activeParticipantId: viewer.activeParticipantId,
          creatorParticipantId,
        }),
        responses: [...option.responses],
      };
    });

    return {
      appointment: publicAppointment.appointment,
      participants: [...publicAppointment.participants],
      options,
      viewer: {
        kind: viewer.kind,
        activeParticipantId: viewer.activeParticipantId,
        accessibleParticipants: viewer.accessibleParticipants,
        needsParticipantName: viewer.needsParticipantName,
        participantEnrollmentError: viewer.participantEnrollmentError,
        permissions,
      },
    };
  }).deferred();
}

export function getAppointmentSnapshot(
  context: ServiceContext,
  input: GetAppointmentSnapshotInput,
  tokenDigester: GuestTokenDigester,
): AppointmentSnapshot {
  try {
    return executeGetAppointmentSnapshot(context, input, tokenDigester);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not load the appointment snapshot.",
      { cause: error },
    );
  }
}
