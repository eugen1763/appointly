import {
  appointmentParamsSchema,
  managerParticipantRequestSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import { createManagerParticipant } from "../../../../../features/appointments/server/management";
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

export type ManagerParticipantSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface ManagerParticipantRouteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: ManagerParticipantSessionReader;
}

export interface ManagerParticipantRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ManagerParticipantPostHandler = (
  request: Request,
  routeContext: ManagerParticipantRouteContext,
) => Promise<Response>;

export function createManagerParticipantPostHandler(
  dependencies: ManagerParticipantRouteDependencies,
): ManagerParticipantPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        managerParticipantRequestSchema,
        await readJsonRequest(request),
      );
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = createManagerParticipant(dependencies.context, {
        publicId: params.publicId,
        userId: identity.userId,
        email: identity.email,
        displayName: body.displayName,
      });

      return Response.json(
        { participantId: result.participantId, revision: result.revision },
        { status: result.created ? 201 : 200 },
      );
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
