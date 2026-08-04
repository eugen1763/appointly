import { eq } from "drizzle-orm";

import { appointments } from "../../../db/schema";
import { AppError } from "../http-errors";
import type { ServiceContext } from "./service-context";

export interface AppointmentEventTarget {
  readonly appointmentId: string;
  readonly revision: number;
}

export function findAppointmentEventTarget(
  context: ServiceContext,
  publicId: string,
): AppointmentEventTarget {
  const appointment = context.db.select({
    appointmentId: appointments.id,
    revision: appointments.revision,
  }).from(appointments).where(eq(appointments.publicId, publicId)).get();

  if (!appointment) {
    throw new AppError("NOT_FOUND", "Appointment was not found.");
  }

  return appointment;
}
