import { randomBytes } from "node:crypto";

import type Database from "better-sqlite3";

import { getDatabaseConnection } from "../../../db";
import type { AppDatabase } from "../../../db/connection";

export interface Clock {
  now(): number;
}

export type TokenFactory = () => Buffer;

export interface EventPublisher {
  publish(appointmentId: string, revision: number): void;
}

export interface ServiceContext {
  readonly db: AppDatabase;
  readonly sqlite: Database.Database;
  readonly clock: Clock;
  readonly tokenFactory: TokenFactory;
  readonly eventPublisher: EventPublisher;
}

export type TransactionContext = Omit<ServiceContext, "eventPublisher">;

export function createProductionServiceContext(
  eventPublisher: EventPublisher,
): ServiceContext {
  const connection = getDatabaseConnection();

  return {
    ...connection,
    clock: { now: Date.now },
    tokenFactory: () => randomBytes(32),
    eventPublisher,
  };
}
