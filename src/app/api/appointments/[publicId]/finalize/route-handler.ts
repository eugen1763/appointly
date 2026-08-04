import {
  appointmentParamsSchema,
  finalizeRequestSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import { finalizeAppointment } from "../../../../../features/appointments/server/management";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../../features/appointments/server/route-support";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../../lib/auth-session";

export type FinalizeAppointmentSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface FinalizeAppointmentRouteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: FinalizeAppointmentSessionReader;
}

export interface FinalizeAppointmentRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type FinalizeAppointmentPostHandler = (
  request: Request,
  routeContext: FinalizeAppointmentRouteContext,
) => Promise<Response>;

export function createFinalizeAppointmentPostHandler(
  dependencies: FinalizeAppointmentRouteDependencies,
): FinalizeAppointmentPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        finalizeRequestSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = finalizeAppointment(dependencies.context, {
        publicId: params.publicId,
        userId: identity.userId,
        optionId: body.optionId,
      });

      return Response.json({ revision: result.revision }, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
