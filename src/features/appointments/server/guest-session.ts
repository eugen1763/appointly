import { and, asc, eq, gt } from "drizzle-orm";

import {
  appointments,
  guestSessionAccess,
  guestSessions,
  participants,
} from "../../../db/schema";
import type { GuestTokenDigester } from "../../../lib/security";
import { AppError } from "../http-errors";
import type { ServiceContext, TransactionContext } from "./service-context";

export const GUEST_SESSION_LIFETIME_MS = 31_536_000_000;

export interface GuestSessionTimestamps {
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly lastSeenAt: number;
}

export interface ValidGuestSession {
  readonly tokenHash: Buffer;
}

export interface GuestSessionDecision extends ValidGuestSession {
  readonly newSessionToken: string | null;
}

export interface LinkedGuestParticipant {
  readonly participantId: string;
  readonly displayName: string;
}

export function parseGuestSessionToken(value: string | null): Buffer | null {
  if (value === null || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value ? bytes : null;
}

export function createGuestSessionTimestamps(now: number): GuestSessionTimestamps {
  const expiresAt = now + GUEST_SESSION_LIFETIME_MS;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt)) {
    throw new RangeError("Guest session timestamps must be safe integers");
  }
  return { createdAt: now, expiresAt, lastSeenAt: now };
}

export function resolveValidGuestSession(
  context: Pick<TransactionContext, "db">,
  rawToken: string | null,
  now: number,
  tokenDigester: GuestTokenDigester,
): ValidGuestSession | null {
  const token = parseGuestSessionToken(rawToken);
  if (token === null) return null;
  const tokenHash = tokenDigester.digestSessionToken(token);
  const session = context.db.select({ tokenHash: guestSessions.tokenHash })
    .from(guestSessions)
    .where(and(
      eq(guestSessions.tokenHash, tokenHash),
      gt(guestSessions.expiresAt, now),
    ))
    .get();
  return session ?? null;
}

export function resolveOrCreateGuestSession(
  context: TransactionContext,
  rawToken: string | null,
  now: number,
  tokenDigester: GuestTokenDigester,
): GuestSessionDecision {
  const presentedToken = parseGuestSessionToken(rawToken);
  let expiredTokenHash: Buffer | null = null;
  if (presentedToken !== null) {
    const presentedTokenHash = tokenDigester.digestSessionToken(presentedToken);
    const presentedSession = context.db.select({
      tokenHash: guestSessions.tokenHash,
      expiresAt: guestSessions.expiresAt,
    }).from(guestSessions)
      .where(eq(guestSessions.tokenHash, presentedTokenHash))
      .get();
    if (presentedSession !== undefined && presentedSession.expiresAt > now) {
      return { tokenHash: presentedSession.tokenHash, newSessionToken: null };
    }
    expiredTokenHash = presentedSession?.tokenHash ?? null;
  }

  const timestamps = createGuestSessionTimestamps(now);
  const token = Buffer.from(context.tokenFactory());
  if (token.length !== 32) {
    throw new RangeError("session token must contain exactly 32 bytes");
  }
  const newSessionToken = token.toString("base64url");
  const tokenHash = tokenDigester.digestSessionToken(token);
  if (expiredTokenHash !== null) {
    context.db.delete(guestSessions)
      .where(eq(guestSessions.tokenHash, expiredTokenHash))
      .run();
  }
  context.db.insert(guestSessions).values({ tokenHash, ...timestamps }).run();
  return { tokenHash, newSessionToken };
}

function executeLinkedGuestAccessResolution(
  context: ServiceContext,
  publicId: string,
  rawToken: string | null,
  tokenDigester: GuestTokenDigester,
): LinkedGuestParticipant[] {
  const session = resolveValidGuestSession(
    context,
    rawToken,
    context.clock.now(),
    tokenDigester,
  );
  if (session === null) return [];

  return context.db.select({
    participantId: participants.id,
    displayName: participants.displayName,
  }).from(guestSessionAccess)
    .innerJoin(
      participants,
      eq(guestSessionAccess.participantId, participants.id),
    )
    .innerJoin(
      appointments,
      eq(participants.appointmentId, appointments.id),
    )
    .where(and(
      eq(guestSessionAccess.sessionTokenHash, session.tokenHash),
      eq(appointments.publicId, publicId),
    ))
    .orderBy(asc(participants.createdAt), asc(participants.id))
    .all();
}

export function resolveLinkedGuestAccess(
  context: ServiceContext,
  publicId: string,
  rawToken: string | null,
  tokenDigester: GuestTokenDigester,
): LinkedGuestParticipant[] {
  try {
    return executeLinkedGuestAccessResolution(context, publicId, rawToken, tokenDigester);
  } catch (error) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Could not resolve guest access.",
      { cause: error },
    );
  }
}
