import { appointmentParamsSchema } from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import { reopenAppointment } from "../../../../../features/appointments/server/management";
import {
  assertExactRequestOrigin,
  parseRouteValue,
} from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../../lib/auth-session";

export type ReopenAppointmentSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface ReopenAppointmentRouteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: ReopenAppointmentSessionReader;
}

export interface ReopenAppointmentRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ReopenAppointmentPostHandler = (
  request: Request,
  routeContext: ReopenAppointmentRouteContext,
) => Promise<Response>;

async function assertNoRequestBody(request: Request): Promise<void> {
  if ((await request.text()).length > 0) {
    throw new AppError("VALIDATION_FAILED", "This request does not accept a body.", {
      fieldErrors: { body: ["Request body must be empty."] },
    });
  }
}

export function createReopenAppointmentPostHandler(
  dependencies: ReopenAppointmentRouteDependencies,
): ReopenAppointmentPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      await assertNoRequestBody(request);
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = reopenAppointment(dependencies.context, {
        publicId: params.publicId,
        userId: identity.userId,
      });
      return Response.json({ revision: result.revision }, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
