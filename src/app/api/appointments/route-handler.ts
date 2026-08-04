import { createAppointmentInputSchema } from "../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../features/appointments/http-errors";
import type {
  CreateAppointmentCommandInput,
  CreateAppointmentResult,
} from "../../../features/appointments/server/create-appointment";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../lib/auth-session";

export type AppointmentsSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type CreateAppointmentCommand = (
  context: ServiceContext,
  input: CreateAppointmentCommandInput,
) => CreateAppointmentResult;

export interface AppointmentsPostDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: AppointmentsSessionReader;
  readonly createAppointment: CreateAppointmentCommand;
}

export type AppointmentsPostHandler = (
  request: Request,
) => Promise<Response>;

export function createAppointmentsPostHandler(
  dependencies: AppointmentsPostDependencies,
): AppointmentsPostHandler {
  return async (request) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const appointment = parseRouteValue(
        createAppointmentInputSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const created = dependencies.createAppointment(dependencies.context, {
        ownerUserId: identity.userId,
        ownerEmail: identity.email,
        appointment,
      });

      return Response.json({
        publicId: created.publicId,
        publicUrl: `${dependencies.appOrigin}/a/${created.publicId}`,
        revision: created.revision,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
