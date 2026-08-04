import { and, asc, count, eq, sql } from "drizzle-orm";

import {
  appointmentOptions,
  appointments,
  participants,
  responses,
} from "../../../db/schema";
import {
  encodeDeleteConfirmationToken,
  verifyDeleteConfirmationToken,
  type DeleteConfirmationDigester,
  type GuestTokenDigester,
  type RateKeyDigester,
} from "../../../lib/security";
import type { DeleteConfirmationDetails, OptionInput } from "../contracts";
import { AppError } from "../http-errors";
import {
  resolveParticipantActor,
  type ParticipantActorIdentity,
} from "./authorization";
import {
  InvalidTimeZoneError,
  optionCreationTime,
  validateOptionInputForStorage,
  validateOptionStartForCreation,
  type OptionStorageValues,
} from "./option-storage";
import {
  consumePublicWriteRateLimit,
  deleteExpiredRateLimitWindows,
} from "./rate-limit";
import type { ServiceContext, TransactionContext } from "./service-context";
import { publishAppointmentRevision, runImmediate } from "./transactions";

export interface AddOptionInput {
  readonly publicId: string;
  readonly participantId: string;
  readonly timeZone: string;
  readonly option: OptionInput;
  readonly identity: ParticipantActorIdentity | null;
  readonly guestSessionToken: string | null;
}

export interface AddOptionResult {
  readonly optionId: string;
  readonly revision: number;
}

interface AddOptionTransactionResult {
  readonly appointmentId: string;
  readonly result: AddOptionResult;
}

export interface DeleteOptionInput {
  readonly publicId: string;
  readonly optionId: string;
  readonly participantId: string;
  readonly confirmationToken?: string;
  readonly identity: ParticipantActorIdentity | null;
  readonly guestSessionToken: string | null;
}

export interface DeleteOptionResult {
  readonly revision: number;
}

interface DeleteOptionTransactionResult {
  readonly appointmentId: string;
  readonly result: DeleteOptionResult;
}

function validationError(
  fieldErrors: Record<string, string[]>,
  cause?: unknown,
): AppError {
  return new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
    fieldErrors,
    ...(cause === undefined ? {} : { cause }),
  });
}

function optionFieldErrors(
  fieldErrors: Partial<Record<string, string[]>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages !== undefined) result[`option.${field}`] = messages;
  }
  return result;
}

function prepareOption(
  option: OptionInput,
  appointmentType: OptionInput["kind"],
  timeZone: string,
  now: number,
): OptionStorageValues {
  if (option.kind !== appointmentType) {
    throw validationError({
      "option.kind": ["Option kind must match appointment type."],
    });
  }

  const storageValidation = validateOptionInputForStorage(option);
  if (!storageValidation.success) {
    throw validationError(optionFieldErrors(storageValidation.fieldErrors));
  }

  let creationTime;
  try {
    creationTime = optionCreationTime(timeZone, now);
  } catch (cause) {
    if (cause instanceof InvalidTimeZoneError) {
      throw validationError({
        timeZone: ["Use a valid IANA time zone."],
      }, cause);
    }
    throw cause;
  }

  const startValidation = validateOptionStartForCreation(
    storageValidation.values,
    creationTime,
  );
  if (!startValidation.success) {
    throw validationError(optionFieldErrors(startValidation.fieldErrors));
  }
  return storageValidation.values;
}

function incrementRevision(
  context: TransactionContext,
  appointmentId: string,
  now: number,
): number {
  return context.db.update(appointments).set({
    revision: sql`${appointments.revision} + 1`,
    updatedAt: now,
  }).where(eq(appointments.id, appointmentId))
    .returning({ revision: appointments.revision })
    .get().revision;
}

function currentYesParticipants(
  context: TransactionContext,
  appointmentId: string,
  optionId: string,
): Array<{ readonly id: string; readonly displayName: string }> {
  return context.db.select({
    id: participants.id,
    displayName: participants.displayName,
  }).from(responses)
    .innerJoin(participants, eq(responses.participantId, participants.id))
    .where(and(
      eq(responses.appointmentId, appointmentId),
      eq(responses.optionId, optionId),
      eq(responses.value, "YES"),
    ))
    .orderBy(asc(participants.id))
    .all();
}

function executeAddOption(
  context: ServiceContext,
  input: AddOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): AddOptionResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const now = transaction.clock.now();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError("Option timestamp must be a safe integer");
    }
    deleteExpiredRateLimitWindows(transaction, now);

    const appointment = transaction.db.select({
      id: appointments.id,
      type: appointments.type,
      status: appointments.status,
      optionLimit: appointments.optionLimit,
    }).from(appointments)
      .where(eq(appointments.publicId, input.publicId))
      .get();
    if (appointment === undefined) {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    }

    const actor = resolveParticipantActor(transaction, {
      appointmentId: appointment.id,
      participantId: input.participantId,
      identity: input.identity,
      guestSessionToken: input.guestSessionToken,
      now,
    }, tokenDigester);

    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before adding an option.",
      );
    }

    const values = prepareOption(
      input.option,
      appointment.type,
      input.timeZone,
      now,
    );
    const optionCount = transaction.db.select({
      value: count(appointmentOptions.id),
    }).from(appointmentOptions)
      .where(eq(appointmentOptions.appointmentId, appointment.id))
      .get()?.value ?? 0;
    if (optionCount >= appointment.optionLimit) {
      throw new AppError(
        "OPTION_LIMIT_REACHED",
        "This appointment has reached its option limit.",
      );
    }

    const duplicate = transaction.db.select({ id: appointmentOptions.id })
      .from(appointmentOptions)
      .where(and(
        eq(appointmentOptions.appointmentId, appointment.id),
        eq(appointmentOptions.canonicalKey, values.canonicalKey),
      ))
      .get();
    if (duplicate !== undefined) {
      throw new AppError(
        "DUPLICATE_OPTION",
        "Each option must be unique within the appointment.",
      );
    }

    consumePublicWriteRateLimit(transaction, {
      appointmentId: appointment.id,
      actor: actor.rateActor,
      now,
    }, rateKeyDigester);

    const option = transaction.db.insert(appointmentOptions).values({
      appointmentId: appointment.id,
      creatorParticipantId: actor.participantId,
      ...values,
      createdAt: now,
    }).returning({ id: appointmentOptions.id }).get();
    transaction.db.insert(responses).values({
      appointmentId: appointment.id,
      participantId: actor.participantId,
      optionId: option.id,
      value: "YES",
      updatedAt: now,
    }).run();

    return {
      appointmentId: appointment.id,
      result: {
        optionId: option.id,
        revision: incrementRevision(transaction, appointment.id, now),
      },
    } satisfies AddOptionTransactionResult;
  });

  publishAppointmentRevision(
    context,
    transactionResult.appointmentId,
    transactionResult.result.revision,
  );
  return transactionResult.result;
}

export function addOption(
  context: ServiceContext,
  input: AddOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): AddOptionResult {
  try {
    return executeAddOption(context, input, tokenDigester, rateKeyDigester);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not add the option.",
      { cause: error },
    );
  }
}

function executeDeleteOption(
  context: ServiceContext,
  input: DeleteOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
  confirmationDigester: DeleteConfirmationDigester,
): DeleteOptionResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const now = transaction.clock.now();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError("Option timestamp must be a safe integer");
    }

    const appointment = transaction.db.select({
      id: appointments.id,
      status: appointments.status,
    }).from(appointments)
      .where(eq(appointments.publicId, input.publicId))
      .get();
    if (appointment === undefined) {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    }

    const actor = resolveParticipantActor(transaction, {
      appointmentId: appointment.id,
      participantId: input.participantId,
      identity: input.identity,
      guestSessionToken: input.guestSessionToken,
      now,
    }, tokenDigester);

    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before deleting an option.",
      );
    }

    const option = transaction.db.select({
      creatorParticipantId: appointmentOptions.creatorParticipantId,
    }).from(appointmentOptions)
      .where(and(
        eq(appointmentOptions.appointmentId, appointment.id),
        eq(appointmentOptions.id, input.optionId),
      ))
      .get();
    if (option === undefined) {
      throw new AppError("NOT_FOUND", "Option was not found.");
    }
    if (option.creatorParticipantId !== actor.participantId) {
      throw new AppError(
        "FORBIDDEN",
        "Only the participant who suggested this option can delete it.",
      );
    }

    const yesParticipants = currentYesParticipants(
      transaction,
      appointment.id,
      input.optionId,
    );
    if (yesParticipants.length > 0) {
      const digest = confirmationDigester.digestDeleteConfirmation(
        appointment.id,
        input.optionId,
        ...yesParticipants.map((participant) => participant.id),
      );
      const details = {
        count: yesParticipants.length,
        names: yesParticipants.map((participant) => participant.displayName),
        token: encodeDeleteConfirmationToken(digest),
      } satisfies DeleteConfirmationDetails;
      if (input.confirmationToken === undefined) {
        throw new AppError(
          "DELETE_CONFIRMATION_REQUIRED",
          "Confirm deletion before removing this option.",
          { details },
        );
      }
      if (!verifyDeleteConfirmationToken(input.confirmationToken, digest)) {
        throw new AppError(
          "STALE_DELETE_CONFIRMATION",
          "Responses changed. Review the current participants and confirm again.",
          { details },
        );
      }
    }

    deleteExpiredRateLimitWindows(transaction, now);
    consumePublicWriteRateLimit(transaction, {
      appointmentId: appointment.id,
      actor: actor.rateActor,
      now,
    }, rateKeyDigester);
    transaction.db.delete(appointmentOptions).where(and(
      eq(appointmentOptions.appointmentId, appointment.id),
      eq(appointmentOptions.id, input.optionId),
    )).run();

    return {
      appointmentId: appointment.id,
      result: {
        revision: incrementRevision(transaction, appointment.id, now),
      },
    } satisfies DeleteOptionTransactionResult;
  });

  publishAppointmentRevision(
    context,
    transactionResult.appointmentId,
    transactionResult.result.revision,
  );
  return transactionResult.result;
}

export function deleteOption(
  context: ServiceContext,
  input: DeleteOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
  confirmationDigester: DeleteConfirmationDigester,
): DeleteOptionResult {
  try {
    return executeDeleteOption(
      context,
      input,
      tokenDigester,
      rateKeyDigester,
      confirmationDigester,
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not delete the option.",
      { cause: error },
    );
  }
}
