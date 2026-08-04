import {
  appointmentParamsSchema,
  deleteAppointmentRequestSchema,
  updateAppointmentRequestSchema,
} from "../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../features/appointments/http-errors";
import {
  deleteAppointment,
  updateAppointment,
} from "../../../../features/appointments/server/management";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../lib/auth-session";

export type AppointmentPatchSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface AppointmentPatchDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: AppointmentPatchSessionReader;
}

export interface AppointmentPatchRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type AppointmentPatchHandler = (
  request: Request,
  routeContext: AppointmentPatchRouteContext,
) => Promise<Response>;

export type AppointmentDeleteSessionReader = AppointmentPatchSessionReader;

export interface AppointmentDeleteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: AppointmentDeleteSessionReader;
}

export interface AppointmentDeleteRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type AppointmentDeleteHandler = (
  request: Request,
  routeContext: AppointmentDeleteRouteContext,
) => Promise<Response>;

export function createAppointmentPatchHandler(
  dependencies: AppointmentPatchDependencies,
): AppointmentPatchHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const changes = parseRouteValue(
        updateAppointmentRequestSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = updateAppointment(dependencies.context, {
        publicId: params.publicId,
        userId: identity.userId,
        changes,
      });
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}

export function createAppointmentDeleteHandler(
  dependencies: AppointmentDeleteDependencies,
): AppointmentDeleteHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        deleteAppointmentRequestSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      deleteAppointment(dependencies.context, {
        publicId: params.publicId,
        userId: identity.userId,
        title: body.title,
      });
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
