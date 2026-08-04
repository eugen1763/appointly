import { eq, lte, sql } from "drizzle-orm";

import { rateLimitWindows } from "../../../db/schema";
import type { RateKeyDigester } from "../../../lib/security";
import { AppError } from "../http-errors";
import type { TransactionContext } from "./service-context";

export const JOIN_RATE_LIMIT = 10;
export const JOIN_RATE_WINDOW_MS = 3_600_000;
export const PUBLIC_WRITE_RATE_LIMIT = 120;
export const PUBLIC_WRITE_RATE_WINDOW_MS = 60_000;

interface FixedWindowInput {
  readonly key: Buffer;
  readonly limit: number;
  readonly now: number;
  readonly windowMs: number;
}

export interface JoinRateLimitInput {
  readonly appointmentId: string;
  readonly guestSessionHash: Buffer | null;
  readonly clientKey: string;
  readonly now: number;
}

export interface PublicWriteRateLimitInput {
  readonly appointmentId: string;
  readonly actor: {
    readonly kind: "user" | "participant";
    readonly id: string;
  };
  readonly now: number;
}

function assertSafeTime(now: number, windowMs?: number): void {
  if (!Number.isSafeInteger(now)) {
    throw new RangeError("Rate-limit timestamp must be a safe integer");
  }
  if (windowMs !== undefined) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new RangeError("Rate-limit window must be a positive safe integer");
    }
    if (!Number.isSafeInteger(now + windowMs)) {
      throw new RangeError("Rate-limit expiry must be a safe integer");
    }
  }
}

function consumeFixedWindow(
  context: TransactionContext,
  input: FixedWindowInput,
): void {
  assertSafeTime(input.now, input.windowMs);
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new RangeError("Rate limit must be a positive safe integer");
  }
  if (input.key.length !== 32) {
    throw new RangeError("Rate-limit key must contain exactly 32 bytes");
  }

  const current = context.db.select({
    count: rateLimitWindows.count,
    expiresAt: rateLimitWindows.expiresAt,
  }).from(rateLimitWindows)
    .where(eq(rateLimitWindows.key, input.key))
    .get();
  const expiresAt = input.now + input.windowMs;
  if (!current || current.expiresAt <= input.now) {
    context.db.insert(rateLimitWindows).values({
      key: input.key,
      count: 1,
      windowStartedAt: input.now,
      expiresAt,
    }).onConflictDoUpdate({
      target: rateLimitWindows.key,
      set: {
        count: 1,
        windowStartedAt: input.now,
        expiresAt,
      },
    }).run();
    return;
  }

  if (current.count >= input.limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Try again later.",
      {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.expiresAt - input.now) / 1_000),
        ),
      },
    );
  }

  context.db.update(rateLimitWindows)
    .set({ count: sql`${rateLimitWindows.count} + 1` })
    .where(eq(rateLimitWindows.key, input.key))
    .run();
}

export function deleteExpiredRateLimitWindows(
  context: TransactionContext,
  now: number,
): void {
  assertSafeTime(now);
  context.db.delete(rateLimitWindows)
    .where(lte(rateLimitWindows.expiresAt, now))
    .run();
}

export function consumeJoinRateLimit(
  context: TransactionContext,
  input: JoinRateLimitInput,
  rateKeyDigester: RateKeyDigester,
): void {
  if (input.guestSessionHash !== null && input.guestSessionHash.length !== 32) {
    throw new RangeError("Guest session digest must contain exactly 32 bytes");
  }
  if (input.clientKey.length === 0) {
    throw new RangeError("Join client key must not be empty");
  }
  const clientKind = input.guestSessionHash === null ? "client" : "session";
  const clientValue = input.guestSessionHash === null
    ? input.clientKey
    : input.guestSessionHash.toString("hex");
  const key = Buffer.from(rateKeyDigester.digestRateKey(
    "join",
    input.appointmentId,
    clientKind,
    clientValue,
  ));
  consumeFixedWindow(context, {
    key,
    limit: JOIN_RATE_LIMIT,
    now: input.now,
    windowMs: JOIN_RATE_WINDOW_MS,
  });
}

export function consumePublicWriteRateLimit(
  context: TransactionContext,
  input: PublicWriteRateLimitInput,
  rateKeyDigester: RateKeyDigester,
): void {
  if (input.actor.id.length === 0) {
    throw new RangeError("Public write actor ID must not be empty");
  }
  const key = Buffer.from(rateKeyDigester.digestRateKey(
    "public-write",
    input.appointmentId,
    input.actor.kind,
    input.actor.id,
  ));
  consumeFixedWindow(context, {
    key,
    limit: PUBLIC_WRITE_RATE_LIMIT,
    now: input.now,
    windowMs: PUBLIC_WRITE_RATE_WINDOW_MS,
  });
}
