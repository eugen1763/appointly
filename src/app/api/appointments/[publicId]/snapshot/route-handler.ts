import {
  appointmentParamsSchema,
  appointmentSnapshotQuerySchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import {
  getAppointmentSnapshot,
  type GetAppointmentSnapshotInput,
} from "../../../../../features/appointments/server/snapshot";
import { parseRouteValue } from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../../../lib/auth-session";
import type { GuestTokenDigester } from "../../../../../lib/security";

export type AppointmentSnapshotSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type AppointmentSnapshotGuestSessionReader = (
  request: Request,
) => string | null;

export interface AppointmentSnapshotGetDependencies {
  readonly context: ServiceContext;
  readonly tokenDigester: GuestTokenDigester;
  readonly readSession: AppointmentSnapshotSessionReader;
  readonly readGuestSessionToken: AppointmentSnapshotGuestSessionReader;
  readonly getSnapshot: typeof getAppointmentSnapshot;
}

export interface AppointmentSnapshotRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type AppointmentSnapshotGetHandler = (
  request: Request,
  routeContext: AppointmentSnapshotRouteContext,
) => Promise<Response>;

function queryValidationError(field: string, message: string): AppError {
  return new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
    fieldErrors: { [field]: [message] },
  });
}

function parseSnapshotQuery(request: Request): { participantId?: string } {
  const values: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key !== "participantId") {
      throw queryValidationError(key, "Unknown query parameter.");
    }
    if (key in values) {
      throw queryValidationError(key, "Query parameter must be provided once.");
    }
    values[key] = value;
  }
  return parseRouteValue(appointmentSnapshotQuerySchema, values);
}

function snapshotIdentity(
  session: ManagerSession | null,
): GetAppointmentSnapshotInput["identity"] {
  if (session === null) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

export function createAppointmentSnapshotGetHandler(
  dependencies: AppointmentSnapshotGetDependencies,
): AppointmentSnapshotGetHandler {
  return async (request, routeContext) => {
    try {
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const query = parseSnapshotQuery(request);
      const session = await dependencies.readSession(request);
      const result = dependencies.getSnapshot(dependencies.context, {
        publicId: params.publicId,
        identity: snapshotIdentity(session),
        requestedParticipantId: query.participantId ?? null,
        guestSessionToken: dependencies.readGuestSessionToken(request),
      }, dependencies.tokenDigester);
      return Response.json(result, {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
