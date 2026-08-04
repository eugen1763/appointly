import { and, eq, sql } from "drizzle-orm";

import {
  appointmentOptions,
  appointments,
  responses,
} from "../../../db/schema";
import type { GuestTokenDigester, RateKeyDigester } from "../../../lib/security";
import { AppError } from "../http-errors";
import {
  resolveParticipantActor,
  type ParticipantActorIdentity,
} from "./authorization";
import {
  consumePublicWriteRateLimit,
  deleteExpiredRateLimitWindows,
} from "./rate-limit";
import type { ServiceContext, TransactionContext } from "./service-context";
import { publishAppointmentRevision, runImmediate } from "./transactions";

export interface PutResponseInput {
  readonly publicId: string;
  readonly optionId: string;
  readonly participantId: string;
  readonly value: "YES" | "NO" | null;
  readonly identity: ParticipantActorIdentity | null;
  readonly guestSessionToken: string | null;
}

export interface PutResponseResult {
  readonly value: "YES" | "NO" | null;
  readonly revision: number;
}

interface PutResponseTransactionResult {
  readonly appointmentId: string;
  readonly changed: boolean;
  readonly result: PutResponseResult;
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

function executePutResponse(
  context: ServiceContext,
  input: PutResponseInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): PutResponseResult {
  const transactionResult = runImmediate(context, (transaction) => {
    const now = transaction.clock.now();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError("Response timestamp must be a safe integer");
    }
    deleteExpiredRateLimitWindows(transaction, now);

    const appointment = transaction.db.select({
      id: appointments.id,
      status: appointments.status,
      revision: appointments.revision,
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
        "Reopen the appointment before changing a response.",
      );
    }

    const option = transaction.db.select({ id: appointmentOptions.id })
      .from(appointmentOptions)
      .where(and(
        eq(appointmentOptions.appointmentId, appointment.id),
        eq(appointmentOptions.id, input.optionId),
      ))
      .get();
    if (option === undefined) {
      throw new AppError("NOT_FOUND", "Appointment option was not found.");
    }

    const existing = transaction.db.select({ value: responses.value })
      .from(responses)
      .where(and(
        eq(responses.appointmentId, appointment.id),
        eq(responses.participantId, actor.participantId),
        eq(responses.optionId, option.id),
      ))
      .get();
    if ((existing?.value ?? null) === input.value) {
      return {
        appointmentId: appointment.id,
        changed: false,
        result: { value: input.value, revision: appointment.revision },
      } satisfies PutResponseTransactionResult;
    }

    consumePublicWriteRateLimit(transaction, {
      appointmentId: appointment.id,
      actor: actor.rateActor,
      now,
    }, rateKeyDigester);

    if (input.value === null) {
      transaction.db.delete(responses).where(and(
        eq(responses.appointmentId, appointment.id),
        eq(responses.participantId, actor.participantId),
        eq(responses.optionId, option.id),
      )).run();
    } else {
      transaction.db.insert(responses).values({
        appointmentId: appointment.id,
        participantId: actor.participantId,
        optionId: option.id,
        value: input.value,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [responses.appointmentId, responses.participantId, responses.optionId],
        set: { value: input.value, updatedAt: now },
      }).run();
    }

    return {
      appointmentId: appointment.id,
      changed: true,
      result: {
        value: input.value,
        revision: incrementRevision(transaction, appointment.id, now),
      },
    } satisfies PutResponseTransactionResult;
  });

  if (transactionResult.changed) {
    publishAppointmentRevision(
      context,
      transactionResult.appointmentId,
      transactionResult.result.revision,
    );
  }
  return transactionResult.result;
}

export function putResponse(
  context: ServiceContext,
  input: PutResponseInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): PutResponseResult {
  try {
    return executePutResponse(context, input, tokenDigester, rateKeyDigester);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not save the response.",
      { cause: error },
    );
  }
}
