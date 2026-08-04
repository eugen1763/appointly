import { managerParamsSchema } from "../../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../../features/appointments/http-errors";
import { removeCoOrganizer } from "../../../../../../features/appointments/server/management";
import {
  assertExactRequestOrigin,
  parseRouteValue,
} from "../../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../../../lib/auth-session";

export type ManagerDeleteSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface ManagerDeleteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: ManagerDeleteSessionReader;
}

export interface ManagerDeleteRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ManagerDeleteHandler = (
  request: Request,
  routeContext: ManagerDeleteRouteContext,
) => Promise<Response>;

function assertNoRequestBody(request: Request): void {
  if (request.body !== null) {
    throw new AppError("VALIDATION_FAILED", "This request does not accept a body.", {
      fieldErrors: { body: ["Request body must be empty."] },
    });
  }
}

export function createManagerDeleteHandler(
  dependencies: ManagerDeleteDependencies,
): ManagerDeleteHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        managerParamsSchema,
        await routeContext.params,
      );
      assertNoRequestBody(request);
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = removeCoOrganizer(dependencies.context, {
        publicId: params.publicId,
        ownerUserId: identity.userId,
        managerId: params.managerId,
      });
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
