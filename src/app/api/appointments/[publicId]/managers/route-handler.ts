import {
  addManagerRequestSchema,
  appointmentParamsSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import {
  inviteCoOrganizer,
  listAppointmentManagers,
} from "../../../../../features/appointments/server/management";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../../lib/auth-session";

export type ManagersSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

interface ManagersBaseDependencies {
  readonly context: ServiceContext;
  readonly readSession: ManagersSessionReader;
}

export type ManagersGetDependencies = ManagersBaseDependencies;

export interface ManagersPostDependencies extends ManagersBaseDependencies {
  readonly appOrigin: string;
}

export interface ManagersRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ManagersGetHandler = (
  request: Request,
  routeContext: ManagersRouteContext,
) => Promise<Response>;

export type ManagersPostHandler = ManagersGetHandler;

export function createManagersGetHandler(
  dependencies: ManagersGetDependencies,
): ManagersGetHandler {
  return async (request, routeContext) => {
    try {
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = listAppointmentManagers(dependencies.context, {
        publicId: params.publicId,
        ownerUserId: identity.userId,
      });
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}

export function createManagersPostHandler(
  dependencies: ManagersPostDependencies,
): ManagersPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        addManagerRequestSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = inviteCoOrganizer(dependencies.context, {
        publicId: params.publicId,
        ownerUserId: identity.userId,
        email: body.email,
      });
      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
