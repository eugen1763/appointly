import { timingSafeEqual } from "node:crypto";

import { and, count, eq, isNull, sql } from "drizzle-orm";

import {
  appointmentManagers,
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../db/schema";
import { normalizeEmail } from "../../../lib/email";
import type { GuestTokenDigester, RateKeyDigester } from "../../../lib/security";
import { AppError } from "../http-errors";
import {
  isValidDisplayNameLength,
  normalizeParticipantName,
  PARTICIPANT_MAX_COUNT,
} from "../validation";
import {
  parseGuestSessionToken,
  resolveOrCreateGuestSession,
  resolveValidGuestSession,
} from "./guest-session";
import {
  consumeJoinRateLimit,
  deleteExpiredRateLimitWindows,
} from "./rate-limit";
import type { ServiceContext, TransactionContext } from "./service-context";
import { publishAppointmentRevision, runImmediate } from "./transactions";

export interface JoinIdentity {
  readonly userId: string;
  readonly email: string;
}

export interface JoinParticipantInput {
  readonly publicId: string;
  readonly displayName: string;
  readonly identity: JoinIdentity | null;
  readonly guestSessionToken: string | null;
  readonly clientKey: string;
}

export type JoinParticipantResult =
  | {
      readonly kind: "guest";
      readonly participantId: string;
      readonly editUrl: string;
      readonly revision: number;
      readonly sessionToken: string | null;
    }
  | {
      readonly kind: "manager";
      readonly participantId: string;
      readonly revision: number;
    };

interface JoinTransactionResult {
  readonly appointmentId: string;
  readonly result: JoinParticipantResult;
}

interface OpaqueToken {
  readonly bytes: Buffer;
  readonly text: string;
}

export interface ExchangeGuestAccessInput {
  readonly publicId: unknown;
  readonly participantId: unknown;
  readonly token: unknown;
  readonly guestSessionToken: string | null;
}

export interface ExchangeGuestAccessResult {
  readonly participantId: string;
  readonly sessionToken: string | null;
}

export interface ResetParticipantLinkInput {
  readonly publicId: string;
  readonly participantId: string;
  readonly managerUserId: string;
}

export interface ResetParticipantLinkResult {
  readonly participantId: string;
  readonly editUrl: string;
  readonly revision: number;
}

interface ResetParticipantLinkTransactionResult {
  readonly appointmentId: string;
  readonly result: ResetParticipantLinkResult;
}

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DUMMY_EDIT_TOKEN = Buffer.alloc(32, 0xa5);
const DUMMY_EDIT_DIGEST: Buffer<ArrayBufferLike> = Buffer.alloc(32);
const INVALID_EDIT_LINK_MESSAGE = "This private edit link is invalid or no longer available.";


function createOpaqueToken(
  context: TransactionContext,
  purpose: "edit" | "session",
): OpaqueToken {
  const bytes = Buffer.from(context.tokenFactory());
  if (bytes.length !== 32) {
    throw new RangeError(`${purpose} token must contain exactly 32 bytes`);
  }
  return { bytes, text: bytes.toString("base64url") };
}


function hasAppointmentSessionAccess(
  context: TransactionContext,
  appointmentId: string,
  sessionTokenHash: Buffer,
): boolean {
  return context.db.select({ participantId: guestSessionAccess.participantId })
    .from(guestSessionAccess)
    .innerJoin(
      participants,
      eq(guestSessionAccess.participantId, participants.id),
    )
    .where(and(
      eq(guestSessionAccess.sessionTokenHash, sessionTokenHash),
      eq(participants.appointmentId, appointmentId),
    ))
    .get() !== undefined;
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

function executeJoinParticipant(
  context: ServiceContext,
  input: JoinParticipantInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): JoinParticipantResult {
  const name = normalizeParticipantName(input.displayName);
  if (!isValidDisplayNameLength(name.displayName)) {
    throw new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
      fieldErrors: {
        displayName: ["Display name must contain 1 to 80 normalized characters"],
      },
    });
  }

  const committed = runImmediate(context, (transactionContext): JoinTransactionResult => {
    const now = transactionContext.clock.now();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError("Join timestamp must be a safe integer");
    }
    deleteExpiredRateLimitWindows(transactionContext, now);
    const appointment = transactionContext.db.select({
      id: appointments.id,
      status: appointments.status,
    }).from(appointments)
      .where(eq(appointments.publicId, input.publicId))
      .get();
    if (!appointment) {
      throw new AppError("NOT_FOUND", "Appointment was not found.");
    }

    const currentParticipantCount = transactionContext.db
      .select({ value: count(participants.id) })
      .from(participants)
      .where(eq(participants.appointmentId, appointment.id))
      .get()?.value ?? 0;
    if (currentParticipantCount >= PARTICIPANT_MAX_COUNT) {
      throw new AppError(
        "PARTICIPANT_LIMIT_REACHED",
        "This appointment already has 200 participants.",
      );
    }
    if (appointment.status === "FINALIZED") {
      throw new AppError(
        "APPOINTMENT_FINALIZED",
        "Reopen the appointment before adding a participant.",
      );
    }


    let pendingManagerId: string | null = null;
    if (input.identity !== null) {
      const boundManager = transactionContext.db
        .select({ id: appointmentManagers.id })
        .from(appointmentManagers)
        .where(and(
          eq(appointmentManagers.appointmentId, appointment.id),
          eq(appointmentManagers.userId, input.identity.userId),
        ))
        .get();
      if (boundManager) {
        throw new AppError(
          "FORBIDDEN",
          "Managers cannot join through the guest participant form.",
        );
      }

      const linkedParticipant = transactionContext.db
        .select({ id: participants.id })
        .from(participants)
        .where(and(
          eq(participants.appointmentId, appointment.id),
          eq(participants.userId, input.identity.userId),
        ))
        .get();
      if (linkedParticipant) {
        throw new AppError(
          "FORBIDDEN",
          "This account already has participant access for this appointment.",
        );
      }

      const emailNormalized = normalizeEmail(input.identity.email);
      pendingManagerId = transactionContext.db
        .select({ id: appointmentManagers.id })
        .from(appointmentManagers)
        .where(and(
          eq(appointmentManagers.appointmentId, appointment.id),
          eq(appointmentManagers.emailNormalized, emailNormalized),
          isNull(appointmentManagers.userId),
        ))
        .get()?.id ?? null;
    }

    let validGuestSessionHash: Buffer | null = null;
    if (pendingManagerId === null) {
      const validSession = resolveValidGuestSession(
        transactionContext,
        input.guestSessionToken,
        now,
        tokenDigester,
      );
      validGuestSessionHash = validSession?.tokenHash ?? null;
      const sessionTokenHash = validSession?.tokenHash ?? null;
      if (
        sessionTokenHash !== null
        && hasAppointmentSessionAccess(
          transactionContext,
          appointment.id,
          sessionTokenHash,
        )
      ) {
        throw new AppError(
          "FORBIDDEN",
          "This browser already has participant access for this appointment.",
        );
      }
    }

    const nameTaken = transactionContext.db.select({ id: participants.id })
      .from(participants)
      .where(and(
        eq(participants.appointmentId, appointment.id),
        eq(participants.normalizedName, name.normalizedName),
      ))
      .get();
    if (nameTaken) {
      throw new AppError(
        "NAME_TAKEN",
        "That display name is already in use.",
      );
    }

    consumeJoinRateLimit(transactionContext, {
      appointmentId: appointment.id,
      guestSessionHash: validGuestSessionHash,
      clientKey: input.clientKey,
      now,
    }, rateKeyDigester);

    if (pendingManagerId !== null && input.identity !== null) {
      transactionContext.db.update(appointmentManagers)
        .set({ userId: input.identity.userId })
        .where(and(
          eq(appointmentManagers.id, pendingManagerId),
          isNull(appointmentManagers.userId),
        ))
        .run();
      const participantId = transactionContext.db.insert(participants).values({
        appointmentId: appointment.id,
        userId: input.identity.userId,
        displayName: name.displayName,
        normalizedName: name.normalizedName,
        editTokenHash: null,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: participants.id }).get().id;
      const revision = incrementRevision(transactionContext, appointment.id, now);
      return {
        appointmentId: appointment.id,
        result: { kind: "manager", participantId, revision },
      };
    }

    const editToken = createOpaqueToken(transactionContext, "edit");
    const session = resolveOrCreateGuestSession(
      transactionContext,
      input.guestSessionToken,
      now,
      tokenDigester,
    );
    const accessTokenHash = session.tokenHash;
    const presentedSessionToken = parseGuestSessionToken(
      session.newSessionToken ?? input.guestSessionToken,
    );
    if (
      presentedSessionToken !== null
      && presentedSessionToken.equals(editToken.bytes)
    ) {
      throw new Error("Edit and session tokens must be independent");
    }

    const participantId = transactionContext.db.insert(participants).values({
      appointmentId: appointment.id,
      userId: null,
      displayName: name.displayName,
      normalizedName: name.normalizedName,
      editTokenHash: tokenDigester.digestEditToken(editToken.bytes),
      createdAt: now,
      updatedAt: now,
    }).returning({ id: participants.id }).get().id;
    transactionContext.db.insert(guestSessionAccess).values({
      sessionTokenHash: accessTokenHash,
      participantId,
      createdAt: now,
    }).run();
    const revision = incrementRevision(transactionContext, appointment.id, now);
    return {
      appointmentId: appointment.id,
      result: {
        kind: "guest",
        participantId,
        editUrl: `/a/${input.publicId}/edit#participant=${participantId}&token=${editToken.text}`,
        revision,
        sessionToken: session.newSessionToken,
      },
    };
  });

  publishAppointmentRevision(
    context,
    committed.appointmentId,
    committed.result.revision,
  );
  return committed.result;
}

export function joinParticipant(
  context: ServiceContext,
  input: JoinParticipantInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
): JoinParticipantResult {
  try {
    return executeJoinParticipant(context, input, tokenDigester, rateKeyDigester);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not join the appointment.",
      { cause: error },
    );
  }
}

function executeGuestAccessExchange(
  context: ServiceContext,
  input: ExchangeGuestAccessInput,
  tokenDigester: GuestTokenDigester,
): ExchangeGuestAccessResult {
  return runImmediate(context, (transactionContext) => {
    const publicId = typeof input.publicId === "string" ? input.publicId : "";
    const participantId = typeof input.participantId === "string"
      ? input.participantId
      : "";
    const editToken = parseGuestSessionToken(
      typeof input.token === "string" ? input.token : null,
    );
    const candidateDigest = Buffer.from(
      tokenDigester.digestEditToken(editToken ?? DUMMY_EDIT_TOKEN),
    );
    if (candidateDigest.length !== 32) {
      throw new RangeError("Edit token digest must contain exactly 32 bytes");
    }

    const participant = transactionContext.db.select({
      id: participants.id,
      editTokenHash: participants.editTokenHash,
    }).from(participants)
      .innerJoin(
        appointments,
        eq(participants.appointmentId, appointments.id),
      )
      .where(and(
        eq(appointments.publicId, publicId),
        eq(participants.id, participantId),
      ))
      .get();
    let hasStoredDigest = false;
    let storedDigest = DUMMY_EDIT_DIGEST;
    if (
      Buffer.isBuffer(participant?.editTokenHash)
      && participant.editTokenHash.length === 32
    ) {
      hasStoredDigest = true;
      storedDigest = participant.editTokenHash;
    }
    const digestMatches = timingSafeEqual(candidateDigest, storedDigest);
    const linkIsValid = PUBLIC_ID_PATTERN.test(publicId)
      && UUID_V4_PATTERN.test(participantId)
      && editToken !== null
      && participant !== undefined
      && hasStoredDigest
      && digestMatches;
    if (!linkIsValid) {
      throw new AppError("INVALID_EDIT_LINK", INVALID_EDIT_LINK_MESSAGE);
    }

    const now = transactionContext.clock.now();
    if (!Number.isSafeInteger(now)) {
      throw new RangeError("Guest access timestamp must be a safe integer");
    }
    const session = resolveOrCreateGuestSession(
      transactionContext,
      input.guestSessionToken,
      now,
      tokenDigester,
    );
    transactionContext.db.insert(guestSessionAccess).values({
      sessionTokenHash: session.tokenHash,
      participantId,
      createdAt: now,
    }).onConflictDoNothing({
      target: [
        guestSessionAccess.sessionTokenHash,
        guestSessionAccess.participantId,
      ],
    }).run();
    transactionContext.db.update(guestSessions)
      .set({ lastSeenAt: now })
      .where(eq(guestSessions.tokenHash, session.tokenHash))
      .run();

    return {
      participantId,
      sessionToken: session.newSessionToken,
    };
  });
}

export function exchangeGuestAccess(
  context: ServiceContext,
  input: ExchangeGuestAccessInput,
  tokenDigester: GuestTokenDigester,
): ExchangeGuestAccessResult {
  try {
    return executeGuestAccessExchange(context, input, tokenDigester);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_EDIT_LINK") {
      throw error;
    }
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not open the private edit link.",
      { cause: error },
    );
  }
}

function executeResetParticipantLink(
  context: ServiceContext,
  input: ResetParticipantLinkInput,
  tokenDigester: GuestTokenDigester,
): ResetParticipantLinkResult {
  const committed = runImmediate(
    context,
    (transactionContext): ResetParticipantLinkTransactionResult => {
      const appointment = transactionContext.db.select({
        id: appointments.id,
        status: appointments.status,
      }).from(appointments)
        .where(eq(appointments.publicId, input.publicId))
        .get();
      if (!appointment) {
        throw new AppError("NOT_FOUND", "Appointment was not found.");
      }

      const manager = transactionContext.db.select({ id: appointmentManagers.id })
        .from(appointmentManagers)
        .where(and(
          eq(appointmentManagers.appointmentId, appointment.id),
          eq(appointmentManagers.userId, input.managerUserId),
        ))
        .get();
      if (!manager) {
        throw new AppError("FORBIDDEN", "Manager access is required.");
      }
      if (appointment.status === "FINALIZED") {
        throw new AppError(
          "APPOINTMENT_FINALIZED",
          "Reopen the appointment before resetting a private edit link.",
        );
      }

      const participant = transactionContext.db.select({ id: participants.id })
        .from(participants)
        .where(and(
          eq(participants.id, input.participantId),
          eq(participants.appointmentId, appointment.id),
        ))
        .get();
      if (!participant) {
        throw new AppError("NOT_FOUND", "Participant was not found.");
      }

      const editToken = createOpaqueToken(transactionContext, "edit");
      const editTokenHash = Buffer.from(
        tokenDigester.digestEditToken(editToken.bytes),
      );
      if (editTokenHash.length !== 32) {
        throw new RangeError("Edit token digest must contain exactly 32 bytes");
      }
      const now = transactionContext.clock.now();
      if (!Number.isSafeInteger(now)) {
        throw new RangeError("Guest link reset timestamp must be a safe integer");
      }

      transactionContext.db.update(participants)
        .set({ editTokenHash, updatedAt: now })
        .where(eq(participants.id, participant.id))
        .run();
      transactionContext.db.delete(guestSessionAccess)
        .where(eq(guestSessionAccess.participantId, participant.id))
        .run();
      const revision = incrementRevision(
        transactionContext,
        appointment.id,
        now,
      );

      return {
        appointmentId: appointment.id,
        result: {
          participantId: participant.id,
          editUrl: `/a/${input.publicId}/edit#participant=${participant.id}&token=${editToken.text}`,
          revision,
        },
      };
    },
  );
  publishAppointmentRevision(
    context,
    committed.appointmentId,
    committed.result.revision,
  );
  return committed.result;
}

export function resetParticipantLink(
  context: ServiceContext,
  input: ResetParticipantLinkInput,
  tokenDigester: GuestTokenDigester,
): ResetParticipantLinkResult {
  try {
    return executeResetParticipantLink(context, input, tokenDigester);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not reset the private edit link.",
      { cause: error },
    );
  }
}
