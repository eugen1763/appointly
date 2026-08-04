import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { count, eq } from "drizzle-orm";

import { createDatabaseConnection } from "../src/db/connection";
import { appointments, participants } from "../src/db/schema";
import { appointmentParamsSchema } from "../src/features/appointments/contracts";
import { normalizeParticipantName } from "../src/features/appointments/validation";

const E2E_DATABASE_PATH = join(process.cwd(), ".tmp", "e2e.sqlite");
const MINIMUM_TARGET_COUNT = 1;
const MAXIMUM_TARGET_COUNT = 200;

function validateTargetCount(targetCount: number): void {
  if (
    !Number.isInteger(targetCount)
    || targetCount < MINIMUM_TARGET_COUNT
    || targetCount > MAXIMUM_TARGET_COUNT
  ) {
    throw new RangeError("Participant target count must be an integer from 1 to 200.");
  }
}

export function countAppointmentParticipants(publicId: string): number {
  const validatedPublicId = appointmentParamsSchema.parse({ publicId }).publicId;
  const connection = createDatabaseConnection(E2E_DATABASE_PATH);

  try {
    const appointment = connection.db.select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.publicId, validatedPublicId))
      .get();
    if (appointment === undefined) {
      throw new Error(`Appointment ${validatedPublicId} was not found in the E2E database.`);
    }

    return connection.db.select({ value: count(participants.id) })
      .from(participants)
      .where(eq(participants.appointmentId, appointment.id))
      .get()?.value ?? 0;
  } finally {
    connection.sqlite.close();
  }
}

export function seedAppointmentParticipants(
  publicId: string,
  targetCount: number,
): number {
  const validatedPublicId = appointmentParamsSchema.parse({ publicId }).publicId;
  validateTargetCount(targetCount);
  const connection = createDatabaseConnection(E2E_DATABASE_PATH);

  try {
    if (connection.sqlite.pragma("foreign_keys", { simple: true }) !== 1) {
      throw new Error("Foreign keys must remain enabled while seeding E2E participants.");
    }

    const seedTransaction = connection.sqlite.transaction((): number => {
      const appointment = connection.db.select({ id: appointments.id })
        .from(appointments)
        .where(eq(appointments.publicId, validatedPublicId))
        .get();
      if (appointment === undefined) {
        throw new Error(`Appointment ${validatedPublicId} was not found in the E2E database.`);
      }

      const currentCount = connection.db.select({ value: count(participants.id) })
        .from(participants)
        .where(eq(participants.appointmentId, appointment.id))
        .get()?.value ?? 0;
      if (targetCount < currentCount) {
        throw new RangeError(
          `Participant target ${targetCount} is below the current count ${currentCount}.`,
        );
      }

      const now = Date.now();
      const rows = Array.from(
        { length: targetCount - currentCount },
        (_, index) => {
          const id = randomUUID();
          const name = normalizeParticipantName(
            `Boundary Seed ${currentCount + index + 1} ${id}`,
          );
          return {
            id,
            appointmentId: appointment.id,
            userId: null,
            displayName: name.displayName,
            normalizedName: name.normalizedName,
            editTokenHash: null,
            createdAt: now,
            updatedAt: now,
          };
        },
      );
      if (rows.length > 0) {
        connection.db.insert(participants).values(rows).run();
      }

      const seededCount = connection.db.select({ value: count(participants.id) })
        .from(participants)
        .where(eq(participants.appointmentId, appointment.id))
        .get()?.value ?? 0;
      if (seededCount !== targetCount) {
        throw new Error(
          `Expected ${targetCount} participants after seeding; found ${seededCount}.`,
        );
      }
      return seededCount;
    });

    return seedTransaction.immediate();
  } finally {
    connection.sqlite.close();
  }
}
