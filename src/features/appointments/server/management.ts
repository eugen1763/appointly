import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { user } from "../../../db/auth-schema";
import {
  appointmentManagers,
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
import { normalizeEmail } from "../../../lib/email";
import type {
  FinalizeRequest,
  OptionValue,
  UpdateAppointmentRequest,
} from "../contracts";
import { AppError } from "../http-errors";
import { leadingOptionIds } from "../leading-option";
import {
  appointmentDetailFieldErrors,
  COORGANIZER_MAX_COUNT,
  isValidDisplayNameLength,
  normalizeParticipantName,
  PARTICIPANT_MAX_COUNT,
  type NormalizedParticipantName,
} from "../validation";
import {
  assertAppointmentDeletionAuthorized,
  assertCanUpdateAppointmentDetails,
} from "./authorization";
import type { ServiceContext, TransactionContext } from "./service-context";
import { projectOption, type PublicOptionRow } from "./snapshot";
import { publishAppointmentRevision, runImmediate } from "./transactions";

interface BoundManagerInput {
  readonly publicId: string;
  readonly userId: string;
}

interface ManagerAccessInput extends BoundManagerInput {
  readonly email: string;
}

export interface EnsureBoundManagerParticipantInput extends ManagerAccessInput {
  readonly googleName: string;
}

export interface ManagerParticipantEnrollment {
  readonly participantId: string | null;
  readonly revision: number;
  readonly created: boolean;
  readonly needsParticipantName: boolean;
  readonly participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED" | null;
}

export interface CreateManagerParticipantInput extends ManagerAccessInput {
  readonly displayName: string;
}

export interface CreateManagerParticipantResult {
  readonly participantId: string;
  readonly revision: number;
  readonly created: boolean;
}
export interface ManagerSummary {
  readonly id: string;
  readonly email: string;
  readonly role: "OWNER" | "COORGANIZER";
  readonly status: "PENDING" | "BOUND";
  readonly canRemove: boolean;
}

export interface InviteCoOrganizerInput {
  readonly publicId: string;
  readonly ownerUserId: string;
  readonly email: string;
}

export interface InviteCoOrganizerResult {
  readonly manager: ManagerSummary & {
    readonly role: "COORGANIZER";
    readonly canRemove: true;
  };
  readonly revision: number;
}

export interface ListAppointmentManagersInput {
  readonly publicId: string;
  readonly ownerUserId: string;
}

export interface ListAppointmentManagersResult {
  readonly managers: readonly ManagerSummary[];
}

export interface RemoveCoOrganizerInput {
  readonly publicId: string;
  readonly ownerUserId: string;
  readonly managerId: string;
}

export interface RemoveCoOrganizerResult {
  readonly revision: number;
}

export interface UpdateAppointmentInput extends BoundManagerInput {
  readonly changes: UpdateAppointmentRequest;
}

export interface UpdateAppointmentResult {
  readonly revision: number;
}

export interface FinalizeAppointmentInput extends BoundManagerInput, FinalizeRequest {}

export interface FinalizeAppointmentResult {
  readonly revision: number;
}

export type ReopenAppointmentInput = BoundManagerInput;

export interface ReopenAppointmentResult {
  readonly revision: number;
}

export interface DeleteAppointmentInput extends BoundManagerInput {
  readonly title: string;
}

export interface BindPendingManagersForDashboardInput {
  readonly userId: string;
  readonly email: string;
}

export interface BoundDashboardAppointment {
  readonly appointmentId: string;
  readonly publicId: string;
  readonly revision: number;
}

export interface BindPendingManagersForDashboardResult {
  readonly boundAppointments: readonly BoundDashboardAppointment[];
}

export interface ListDashboardAppointmentsInput {
  readonly userId: string;
}

export interface DashboardLeadingOption {
  readonly option: OptionValue & { readonly id: string };
  readonly yesCount: number;
  readonly noCount: number;
  readonly tied: boolean;
}

export interface DashboardAppointment {
  readonly publicId: string;
  readonly title: string;
  readonly type: "DATE" | "DATE_TIME" | "DATE_RANGE" | "DATE_TIME_RANGE";
  readonly status: "ACTIVE" | "FINALIZED";
  readonly updatedAt: number;
  readonly role: "OWNER" | "COORGANIZER";
  readonly optionCount: number;
  readonly participantCount: number;
  readonly leadingOption: DashboardLeadingOption | null;
}

export interface ListDashboardAppointmentsResult {
  readonly appointments: readonly DashboardAppointment[];
}

interface AppointmentEnrollmentRecord {
  readonly id: string;
  readonly status: "ACTIVE" | "FINALIZED";
  readonly revision: number;
}

interface AppointmentUpdateRecord extends AppointmentEnrollmentRecord {
  readonly title: string;
  readonly description: string | null;
  readonly optionLimit: number;
  readonly managerRole: "OWNER" | "COORGANIZER";
}

function findBoundManagerAppointment(
  context: TransactionContext,
  input: BoundManagerInput,
): AppointmentUpdateRecord {
  const appointment = context.db.select({
    id: appointments.id,
    title: appointments.title,
    description: appointments.description,
    status: appointments.status,
    optionLimit: appointments.optionLimit,
    revision: appointments.revision,
  }).from(appointments).where(eq(appointments.publicId, input.publicId)).get();

  if (!appointment) {
    throw new AppError("NOT_FOUND", "Appointment was not found.");
  }

  const manager = context.db.select({ role: appointmentManagers.role })
    .from(appointmentManagers)
    .where(and(
      eq(appointmentManagers.appointmentId, appointment.id),
      eq(appointmentManagers.userId, input.userId),
    ))
    .get();

  if (!manager) {
    throw new AppError("FORBIDDEN", "Manager access is required.");
  }

  return { ...appointment, managerRole: manager.role };
}
function findManagerAppointmentForAccess(
  context: TransactionContext,
  input: ManagerAccessInput,
): AppointmentEnrollmentRecord & { readonly managerWasBound: boolean } {
  const appointment = context.db.select({
    id: appointments.id,
    status: appointments.status,
    revision: appointments.revision,
  }).from(appointments).where(eq(appointments.publicId, input.publicId)).get();
  if (!appointment) {
    throw new AppError("NOT_FOUND", "Appointment was not found.");
  }

  const boundManager = context.db.select({ id: appointmentManagers.id })
    .from(appointmentManagers)
    .where(and(
      eq(appointmentManagers.appointmentId, appointment.id),
      eq(appointmentManagers.userId, input.userId),
    ))
    .get();
  if (boundManager) return { ...appointment, managerWasBound: false };

  const emailNormalized = normalizeEmail(input.email);
  const pendingManager = context.db.select({ id: appointmentManagers.id })
    .from(appointmentManagers)
    .where(and(
      eq(appointmentManagers.appointmentId, appointment.id),
      eq(appointmentManagers.emailNormalized, emailNormalized),
      isNull(appointmentManagers.userId),
    ))
    .get();
  if (!pendingManager) {
    throw new AppError("FORBIDDEN", "Manager access is required.");
  }

  context.db.update(appointmentManagers)
    .set({ userId: input.userId })
    .where(and(
      eq(appointmentManagers.id, pendingManager.id),
      isNull(appointmentManagers.userId),
    ))
    .run();
  return { ...appointment, managerWasBound: true };
}

function findLinkedParticipant(
  context: TransactionContext,
  appointmentId: string,
  userId: string,
): string | null {
  return context.db.select({ id: participants.id })
    .from(participants)
    .where(and(
      eq(participants.appointmentId, appointmentId),
      eq(participants.userId, userId),
    ))
    .get()?.id ?? null;
}

function participantNameIsTaken(
  context: TransactionContext,
  appointmentId: string,
  normalizedName: string,
): boolean {
  return context.db.select({ id: participants.id })
    .from(participants)
    .where(and(
      eq(participants.appointmentId, appointmentId),
      eq(participants.normalizedName, normalizedName),
    ))
    .get() !== undefined;
}

function participantCount(
  context: TransactionContext,
  appointmentId: string,
): number {
  return context.db.select({ value: count(participants.id) })
    .from(participants)
    .where(eq(participants.appointmentId, appointmentId))
    .get()?.value ?? 0;
}

function insertLinkedParticipant(
  context: TransactionContext,
  appointmentId: string,
  userId: string,
  name: NormalizedParticipantName,
): string {
  const now = context.clock.now();
  return context.db.insert(participants).values({
    appointmentId,
    userId,
    displayName: name.displayName,
    normalizedName: name.normalizedName,
    editTokenHash: null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: participants.id }).get().id;
}

function incrementAppointmentRevision(
  context: TransactionContext,
  appointmentId: string,
): number {
  return context.db.update(appointments).set({
    revision: sql`${appointments.revision} + 1`,
    updatedAt: context.clock.now(),
  }).where(eq(appointments.id, appointmentId))
    .returning({ revision: appointments.revision })
    .get().revision;
}

function validateAppointmentUpdate(changes: UpdateAppointmentRequest): void {
  const keys = Object.keys(changes);
  if (
    keys.length === 0
    || keys.some(
      (key) =>
        key !== "title"
        && key !== "description"
        && key !== "optionLimit",
    )
  ) {
    throw new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
      fieldErrors: { body: ["Submit at least one appointment detail."] },
    });
  }

  const fieldErrors = appointmentDetailFieldErrors(changes);
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
      fieldErrors,
    });
  }
}

export function updateAppointment(
  context: ServiceContext,
  input: UpdateAppointmentInput,
): UpdateAppointmentResult {
  validateAppointmentUpdate(input.changes);

  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findBoundManagerAppointment(transaction, input);
    assertCanUpdateAppointmentDetails(appointment.status);

    if (input.changes.optionLimit !== undefined) {
      const optionCount = transaction.db.select({
        value: count(appointmentOptions.id),
      }).from(appointmentOptions).where(
        eq(appointmentOptions.appointmentId, appointment.id),
      ).get()?.value ?? 0;
      if (input.changes.optionLimit < optionCount) {
        throw new AppError(
          "LIMIT_BELOW_CURRENT_COUNT",
          "Option limit cannot be lower than the current option count.",
        );
      }
    }

    const changedValues: UpdateAppointmentRequest = {};
    if (
      input.changes.title !== undefined
      && input.changes.title !== appointment.title
    ) {
      changedValues.title = input.changes.title;
    }
    if (
      input.changes.description !== undefined
      && input.changes.description !== appointment.description
    ) {
      changedValues.description = input.changes.description;
    }
    if (
      input.changes.optionLimit !== undefined
      && input.changes.optionLimit !== appointment.optionLimit
    ) {
      changedValues.optionLimit = input.changes.optionLimit;
    }

    if (Object.keys(changedValues).length === 0) {
      return {
        appointmentId: appointment.id,
        changed: false as const,
        revision: appointment.revision,
      };
    }

    const now = transaction.clock.now();
    const updated = transaction.db.update(appointments).set({
      ...changedValues,
      revision: sql`${appointments.revision} + 1`,
      updatedAt: now,
    }).where(eq(appointments.id, appointment.id))
      .returning({ revision: appointments.revision })
      .get();
    return {
      appointmentId: appointment.id,
      changed: true as const,
      revision: updated.revision,
    };
  });

  if (transactionResult.changed) {
    publishAppointmentRevision(
      context,
      transactionResult.appointmentId,
      transactionResult.revision,
    );
  }
  return { revision: transactionResult.revision };
}

export function finalizeAppointment(
  context: ServiceContext,
  input: FinalizeAppointmentInput,
): FinalizeAppointmentResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findBoundManagerAppointment(transaction, input);
    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "This appointment has already been finalized.",
      );
    }

    const option = transaction.db.select({ id: appointmentOptions.id })
      .from(appointmentOptions)
      .where(and(
        eq(appointmentOptions.appointmentId, appointment.id),
        eq(appointmentOptions.id, input.optionId),
      ))
      .get();
    if (!option) {
      throw new AppError(
        "INVALID_FINAL_OPTION",
        "Select an option from this appointment.",
      );
    }

    const updated = transaction.db.update(appointments).set({
      status: "FINALIZED",
      finalOptionId: option.id,
      revision: sql`${appointments.revision} + 1`,
      updatedAt: transaction.clock.now(),
    }).where(and(
      eq(appointments.id, appointment.id),
      eq(appointments.status, "ACTIVE"),
    )).returning({ revision: appointments.revision }).get();
    if (!updated) {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "This appointment has already been finalized.",
      );
    }

    return {
      appointmentId: appointment.id,
      revision: updated.revision,
    };
  });

  publishAppointmentRevision(
    context,
    transactionResult.appointmentId,
    transactionResult.revision,
  );
  return { revision: transactionResult.revision };
}

export function reopenAppointment(
  context: ServiceContext,
  input: ReopenAppointmentInput,
): ReopenAppointmentResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findBoundManagerAppointment(transaction, input);
    if (appointment.status === "ACTIVE") {
      return {
        appointmentId: appointment.id,
        revision: appointment.revision,
        changed: false,
      } as const;
    }

    const updated = transaction.db.update(appointments).set({
      status: "ACTIVE",
      finalOptionId: null,
      revision: sql`${appointments.revision} + 1`,
      updatedAt: transaction.clock.now(),
    }).where(and(
      eq(appointments.id, appointment.id),
      eq(appointments.status, "FINALIZED"),
    )).returning({ revision: appointments.revision }).get();
    if (!updated) {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    }

    return {
      appointmentId: appointment.id,
      revision: updated.revision,
      changed: true,
    } as const;
  });

  if (transactionResult.changed) {
    publishAppointmentRevision(
      context,
      transactionResult.appointmentId,
      transactionResult.revision,
    );
  }
  return { revision: transactionResult.revision };
}

export function deleteAppointment(
  context: ServiceContext,
  input: DeleteAppointmentInput,
): void {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findBoundManagerAppointment(transaction, input);
    assertAppointmentDeletionAuthorized({
      managerRole: appointment.managerRole,
      appointmentTitle: appointment.title,
      confirmationTitle: input.title,
    });

    const tombstoneRevision = appointment.revision + 1;
    if (appointment.status === "FINALIZED") {
      transaction.db.update(appointments).set({
        status: "ACTIVE",
        finalOptionId: null,
      }).where(eq(appointments.id, appointment.id)).run();
    }
    transaction.db.delete(appointments)
      .where(eq(appointments.id, appointment.id))
      .run();

    return {
      appointmentId: appointment.id,
      revision: tombstoneRevision,
    };
  });

  publishAppointmentRevision(
    context,
    transactionResult.appointmentId,
    transactionResult.revision,
  );
}

export function deriveManagerParticipantName(
  googleName: string,
  email: string,
): NormalizedParticipantName {
  const googleDerived = normalizeParticipantName(googleName);
  if (googleDerived.displayName !== "") return googleDerived;

  const normalizedEmail = normalizeEmail(email);
  const localPart = normalizedEmail.slice(0, normalizedEmail.lastIndexOf("@"));
  return normalizeParticipantName(localPart);
}

export function ensureBoundManagerParticipant(
  context: ServiceContext,
  input: EnsureBoundManagerParticipantInput,
): ManagerParticipantEnrollment {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findManagerAppointmentForAccess(transaction, input);
    const finish = (
      enrollment: Omit<ManagerParticipantEnrollment, "revision">,
      participantWasCreated = false,
    ) => {
      const changed = appointment.managerWasBound || participantWasCreated;
      const revision = changed
        ? incrementAppointmentRevision(transaction, appointment.id)
        : appointment.revision;
      return {
        appointmentId: appointment.id,
        changed,
        enrollment: { ...enrollment, revision } satisfies ManagerParticipantEnrollment,
      };
    };

    const existingParticipantId = findLinkedParticipant(
      transaction,
      appointment.id,
      input.userId,
    );
    if (existingParticipantId) {
      return finish({
        participantId: existingParticipantId,
        created: false,
        needsParticipantName: false,
        participantEnrollmentError: null,
      });
    }

    if (appointment.status === "FINALIZED") {
      return finish({
        participantId: null,
        created: false,
        needsParticipantName: false,
        participantEnrollmentError: null,
      });
    }

    const name = deriveManagerParticipantName(input.googleName, input.email);
    if (
      !isValidDisplayNameLength(name.displayName)
      || participantNameIsTaken(transaction, appointment.id, name.normalizedName)
    ) {
      return finish({
        participantId: null,
        created: false,
        needsParticipantName: true,
        participantEnrollmentError: null,
      });
    }

    if (participantCount(transaction, appointment.id) >= PARTICIPANT_MAX_COUNT) {
      return finish({
        participantId: null,
        created: false,
        needsParticipantName: false,
        participantEnrollmentError: "PARTICIPANT_LIMIT_REACHED",
      });
    }

    const participantId = insertLinkedParticipant(
      transaction,
      appointment.id,
      input.userId,
      name,
    );
    return finish({
      participantId,
      created: true,
      needsParticipantName: false,
      participantEnrollmentError: null,
    }, true);
  });

  if (transactionResult.changed) {
    context.eventPublisher.publish(
      transactionResult.appointmentId,
      transactionResult.enrollment.revision,
    );
  }
  return transactionResult.enrollment;
}

export function createManagerParticipant(
  context: ServiceContext,
  input: CreateManagerParticipantInput,
): CreateManagerParticipantResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findManagerAppointmentForAccess(transaction, input);
    const finishConflict = (error: AppError) => {
      if (!appointment.managerWasBound) throw error;
      const revision = incrementAppointmentRevision(transaction, appointment.id);
      return {
        appointmentId: appointment.id,
        changed: true,
        revision,
        result: null,
        conflict: error,
      };
    };

    const existingParticipantId = findLinkedParticipant(
      transaction,
      appointment.id,
      input.userId,
    );
    if (existingParticipantId) {
      const revision = appointment.managerWasBound
        ? incrementAppointmentRevision(transaction, appointment.id)
        : appointment.revision;
      return {
        appointmentId: appointment.id,
        changed: appointment.managerWasBound,
        revision,
        result: {
          participantId: existingParticipantId,
          revision,
          created: false,
        },
        conflict: null,
      };
    }

    if (appointment.status === "FINALIZED") {
      return finishConflict(new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before enrolling as a participant.",
      ));
    }

    const name = normalizeParticipantName(input.displayName);
    if (!isValidDisplayNameLength(name.displayName)) {
      throw new AppError("VALIDATION_FAILED", "Enter a display name.", {
        fieldErrors: {
          displayName: ["Display name must contain 1 to 80 normalized characters."],
        },
      });
    }
    if (participantNameIsTaken(transaction, appointment.id, name.normalizedName)) {
      return finishConflict(
        new AppError("NAME_TAKEN", "That participant name is already in use."),
      );
    }
    if (participantCount(transaction, appointment.id) >= PARTICIPANT_MAX_COUNT) {
      return finishConflict(new AppError(
        "PARTICIPANT_LIMIT_REACHED",
        "This appointment already has 200 participants.",
      ));
    }

    const participantId = insertLinkedParticipant(
      transaction,
      appointment.id,
      input.userId,
      name,
    );
    const revision = incrementAppointmentRevision(transaction, appointment.id);
    return {
      appointmentId: appointment.id,
      changed: true,
      revision,
      result: { participantId, revision, created: true },
      conflict: null,
    };
  });

  if (transactionResult.changed) {
    context.eventPublisher.publish(
      transactionResult.appointmentId,
      transactionResult.revision,
    );
  }
  if (transactionResult.conflict) throw transactionResult.conflict;
  return transactionResult.result;
}

interface OwnerAppointmentRecord {
  readonly id: string;
  readonly status: "ACTIVE" | "FINALIZED";
  readonly revision: number;
}

function findOwnerAppointment(
  context: TransactionContext,
  publicId: string,
  ownerUserId: string,
): OwnerAppointmentRecord {
  const appointment = context.db.select({
    id: appointments.id,
    ownerUserId: appointments.ownerUserId,
    status: appointments.status,
    revision: appointments.revision,
  }).from(appointments).where(eq(appointments.publicId, publicId)).get();
  if (!appointment) {
    throw new AppError("NOT_FOUND", "Appointment was not found.");
  }
  if (appointment.ownerUserId !== ownerUserId) {
    throw new AppError("FORBIDDEN", "Appointment owner access is required.");
  }
  return appointment;
}

function managerSummary(
  row: typeof appointmentManagers.$inferSelect,
): ManagerSummary {
  return {
    id: row.id,
    email: row.emailNormalized,
    role: row.role,
    status: row.userId === null ? "PENDING" : "BOUND",
    canRemove: row.role === "COORGANIZER",
  };
}

export function inviteCoOrganizer(
  context: ServiceContext,
  input: InviteCoOrganizerInput,
): InviteCoOrganizerResult {
  const emailNormalized = normalizeEmail(input.email);
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findOwnerAppointment(
      transaction,
      input.publicId,
      input.ownerUserId,
    );
    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before inviting a co-organizer.",
      );
    }

    const matchingUser = transaction.db.select({ id: user.id })
      .from(user)
      .where(sql`lower(trim(${user.email}, ${"\t\n\v\f\r "})) = ${emailNormalized}`)
      .get();
    const duplicate = transaction.db.select({ id: appointmentManagers.id })
      .from(appointmentManagers)
      .where(and(
        eq(appointmentManagers.appointmentId, appointment.id),
        matchingUser
          ? sql`(${appointmentManagers.emailNormalized} = ${emailNormalized} OR ${appointmentManagers.userId} = ${matchingUser.id})`
          : eq(appointmentManagers.emailNormalized, emailNormalized),
      ))
      .get();
    if (duplicate) {
      throw new AppError(
        "MANAGER_ALREADY_EXISTS",
        "That email already belongs to an appointment manager.",
      );
    }

    const coOrganizerCount = transaction.db.select({
      value: count(appointmentManagers.id),
    }).from(appointmentManagers).where(and(
      eq(appointmentManagers.appointmentId, appointment.id),
      eq(appointmentManagers.role, "COORGANIZER"),
    )).get()?.value ?? 0;
    if (coOrganizerCount >= COORGANIZER_MAX_COUNT) {
      throw new AppError(
        "COORGANIZER_LIMIT_REACHED",
        "This appointment already has 20 co-organizers.",
      );
    }

    const row = transaction.db.insert(appointmentManagers).values({
      appointmentId: appointment.id,
      emailNormalized,
      userId: matchingUser?.id ?? null,
      role: "COORGANIZER",
      createdAt: transaction.clock.now(),
    }).returning().get();
    const revision = incrementAppointmentRevision(transaction, appointment.id);
    return {
      appointmentId: appointment.id,
      result: {
        manager: {
          ...managerSummary(row),
          role: "COORGANIZER" as const,
          canRemove: true as const,
        },
        revision,
      },
    };
  });

  context.eventPublisher.publish(
    transactionResult.appointmentId,
    transactionResult.result.revision,
  );
  return transactionResult.result;
}

export function listAppointmentManagers(
  context: ServiceContext,
  input: ListAppointmentManagersInput,
): ListAppointmentManagersResult {
  const appointment = findOwnerAppointment(context, input.publicId, input.ownerUserId);
  const rows = context.db.select().from(appointmentManagers)
    .where(eq(appointmentManagers.appointmentId, appointment.id))
    .orderBy(appointmentManagers.createdAt, appointmentManagers.id)
    .all();
  return { managers: rows.map(managerSummary) };
}

export function removeCoOrganizer(
  context: ServiceContext,
  input: RemoveCoOrganizerInput,
): RemoveCoOrganizerResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const appointment = findOwnerAppointment(
      transaction,
      input.publicId,
      input.ownerUserId,
    );
    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before removing a co-organizer.",
      );
    }

    const manager = transaction.db.select().from(appointmentManagers)
      .where(and(
        eq(appointmentManagers.appointmentId, appointment.id),
        eq(appointmentManagers.id, input.managerId),
      ))
      .get();
    if (!manager) {
      throw new AppError("NOT_FOUND", "Appointment manager was not found.");
    }
    if (manager.role === "OWNER") {
      throw new AppError("FORBIDDEN", "The appointment owner cannot be removed.");
    }

    transaction.db.delete(appointmentManagers)
      .where(eq(appointmentManagers.id, manager.id))
      .run();
    return {
      appointmentId: appointment.id,
      revision: incrementAppointmentRevision(transaction, appointment.id),
    };
  });

  context.eventPublisher.publish(
    transactionResult.appointmentId,
    transactionResult.revision,
  );
  return { revision: transactionResult.revision };
}

export function bindPendingManagersForDashboard(
  context: ServiceContext,
  input: BindPendingManagersForDashboardInput,
): BindPendingManagersForDashboardResult {
  const emailNormalized = normalizeEmail(input.email);
  const boundAppointments = runImmediate(context, (transaction) => {
    const pendingRows = transaction.db.select({
      managerId: appointmentManagers.id,
      appointmentId: appointments.id,
      publicId: appointments.publicId,
    }).from(appointmentManagers)
      .innerJoin(
        appointments,
        eq(appointments.id, appointmentManagers.appointmentId),
      )
      .where(and(
        eq(appointmentManagers.emailNormalized, emailNormalized),
        isNull(appointmentManagers.userId),
      ))
      .orderBy(appointments.createdAt, appointments.publicId, appointmentManagers.id)
      .all();

    return pendingRows.map((pending) => {
      transaction.db.update(appointmentManagers)
        .set({ userId: input.userId })
        .where(and(
          eq(appointmentManagers.id, pending.managerId),
          isNull(appointmentManagers.userId),
        ))
        .run();
      return {
        appointmentId: pending.appointmentId,
        publicId: pending.publicId,
        revision: incrementAppointmentRevision(transaction, pending.appointmentId),
      };
    });
  });

  for (const appointment of boundAppointments) {
    context.eventPublisher.publish(appointment.appointmentId, appointment.revision);
  }
  return { boundAppointments };
}

interface DashboardTally {
  readonly optionCount: number;
  readonly participantCount: number;
  readonly leadingOption: DashboardLeadingOption | null;
}

const EMPTY_TALLY: DashboardTally = {
  optionCount: 0,
  participantCount: 0,
  leadingOption: null,
};

interface DashboardTallyInput {
  readonly id: string;
  readonly type: DashboardAppointment["type"];
  readonly status: DashboardAppointment["status"];
}

/**
 * The card shows a label, never a roster, so the per-participant responses the
 * snapshot projection carries are dropped rather than shipped to every card.
 */
function leadingOptionValue(
  type: DashboardAppointment["type"],
  row: PublicOptionRow,
): DashboardLeadingOption["option"] {
  const { responses: _unusedResponses, ...value } = projectOption(type, row, []);
  return value;
}

/**
 * Three bounded queries for the whole page rather than three per card: the
 * dashboard has no pagination, so a per-appointment tally would grow the request
 * with the organizer's history.
 */
function dashboardTallies(
  context: ServiceContext,
  rows: readonly DashboardTallyInput[],
): ReadonlyMap<string, DashboardTally> {
  const tallies = new Map<string, DashboardTally>();
  if (rows.length === 0) return tallies;
  const ids = rows.map(({ id }) => id);

  const optionRows = context.db.select({
    appointmentId: appointmentOptions.appointmentId,
    id: appointmentOptions.id,
    startDate: appointmentOptions.startDate,
    endDate: appointmentOptions.endDate,
    startAt: appointmentOptions.startAt,
    endAt: appointmentOptions.endAt,
  }).from(appointmentOptions)
    .where(inArray(appointmentOptions.appointmentId, ids))
    // The storage index order, which is also the order the snapshot reads options in.
    .orderBy(
      asc(appointmentOptions.appointmentId),
      asc(appointmentOptions.startDate),
      asc(appointmentOptions.startAt),
      asc(appointmentOptions.createdAt),
      asc(appointmentOptions.id),
    )
    .all();

  const tallyRows = context.db.select({
    appointmentId: responses.appointmentId,
    optionId: responses.optionId,
    yesCount: sql<number>`sum(case when ${responses.value} = 'YES' then 1 else 0 end)`,
    totalCount: count(),
  }).from(responses)
    .where(inArray(responses.appointmentId, ids))
    .groupBy(responses.appointmentId, responses.optionId)
    .all();

  const participantRows = context.db.select({
    appointmentId: participants.appointmentId,
    participantCount: count(participants.id),
  }).from(participants)
    .where(inArray(participants.appointmentId, ids))
    .groupBy(participants.appointmentId)
    .all();

  const optionsByAppointment = new Map<string, typeof optionRows>();
  for (const option of optionRows) {
    const collected = optionsByAppointment.get(option.appointmentId) ?? [];
    collected.push(option);
    optionsByAppointment.set(option.appointmentId, collected);
  }
  const countsByOption = new Map(tallyRows.map((row) => [row.optionId, {
    yesCount: Number(row.yesCount),
    totalCount: Number(row.totalCount),
  }] as const));
  const participantCounts = new Map(participantRows.map((row) => (
    [row.appointmentId, Number(row.participantCount)] as const
  )));

  for (const row of rows) {
    const options = optionsByAppointment.get(row.id) ?? [];
    const yesCounts = options.map((option) => ({
      id: option.id,
      yesCount: countsByOption.get(option.id)?.yesCount ?? 0,
    }));
    const leadingIds = row.status === "FINALIZED"
      ? new Set<string>()
      : leadingOptionIds(yesCounts);
    const leader = options.find((option) => leadingIds.has(option.id)) ?? null;
    const leaderCounts = leader
      ? countsByOption.get(leader.id) ?? { yesCount: 0, totalCount: 0 }
      : null;
    tallies.set(row.id, {
      optionCount: options.length,
      participantCount: participantCounts.get(row.id) ?? 0,
      leadingOption: leader && leaderCounts
        ? {
          option: leadingOptionValue(row.type, leader),
          yesCount: leaderCounts.yesCount,
          noCount: leaderCounts.totalCount - leaderCounts.yesCount,
          tied: leadingIds.size > 1,
        }
        : null,
    });
  }
  return tallies;
}

export function listDashboardAppointments(
  context: ServiceContext,
  input: ListDashboardAppointmentsInput,
): ListDashboardAppointmentsResult {
  const rows = context.db.select({
    id: appointments.id,
    publicId: appointments.publicId,
    title: appointments.title,
    type: appointments.type,
    status: appointments.status,
    updatedAt: appointments.updatedAt,
    ownerUserId: appointments.ownerUserId,
  }).from(appointments)
    .leftJoin(
      appointmentManagers,
      and(
        eq(appointmentManagers.appointmentId, appointments.id),
        eq(appointmentManagers.userId, input.userId),
      ),
    )
    .where(or(
      eq(appointments.ownerUserId, input.userId),
      eq(appointmentManagers.userId, input.userId),
    ))
    .orderBy(desc(appointments.updatedAt), asc(appointments.publicId))
    .all();

  const uniqueRows = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (uniqueRows.has(row.publicId)) continue;
    uniqueRows.set(row.publicId, row);
  }

  const tallies = dashboardTallies(context, [...uniqueRows.values()]);
  return {
    appointments: [...uniqueRows.values()].map((row) => ({
      publicId: row.publicId,
      title: row.title,
      type: row.type,
      status: row.status,
      updatedAt: row.updatedAt,
      role: row.ownerUserId === input.userId ? "OWNER" : "COORGANIZER",
      ...(tallies.get(row.id) ?? EMPTY_TALLY),
    })),
  };
}
