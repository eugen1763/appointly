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

/**
 * Rejects a body by its content, not by the presence of a stream: Next attaches
 * a stream to every incoming request, so a `request.body !== null` test rejects
 * every real caller. Matches the reopen and reset-link routes.
 */
async function assertNoRequestBody(request: Request): Promise<void> {
  if ((await request.text()).length > 0) {
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
      await assertNoRequestBody(request);
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
