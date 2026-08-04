import {
  appointmentParamsSchema,
  joinParticipantRequestSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import { joinParticipant } from "../../../../../features/appointments/server/guest-access";
import {
  readGuestSessionCookie,
  serializeGuestSessionCookie,
} from "../../../../../features/appointments/server/guest-session-storage";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
  resolveJoinClientKey,
} from "../../../../../features/appointments/server/route-support";
import type { ManagerSession } from "../../../../../lib/auth-session";
import type {
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../lib/security";

export type ParticipantSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export interface ParticipantRouteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: ParticipantSessionReader;
  readonly tokenDigester: GuestTokenDigester;
  readonly rateKeyDigester: RateKeyDigester;
  readonly trustProxy: boolean;
}

export interface ParticipantRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ParticipantPostHandler = (
  request: Request,
  routeContext: ParticipantRouteContext,
) => Promise<Response>;

export function createParticipantPostHandler(
  dependencies: ParticipantRouteDependencies,
): ParticipantPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        joinParticipantRequestSchema,
        await readJsonRequest(request),
      );
      const guestSessionToken = readGuestSessionCookie(request);
      const session = await dependencies.readSession(request);
      const result = joinParticipant(dependencies.context, {
        publicId: params.publicId,
        displayName: body.displayName,
        identity: session === null
          ? null
          : { userId: session.user.id, email: session.user.email },
        guestSessionToken,
        clientKey: resolveJoinClientKey(request, dependencies.trustProxy),
      }, dependencies.tokenDigester, dependencies.rateKeyDigester);

      if (result.kind === "manager") {
        return Response.json({
          participantId: result.participantId,
          revision: result.revision,
        }, { status: 201 });
      }

      const headers = new Headers();
      if (result.sessionToken !== null) {
        headers.set(
          "Set-Cookie",
          serializeGuestSessionCookie(result.sessionToken, dependencies.appOrigin),
        );
      }
      return Response.json({
        participantId: result.participantId,
        editUrl: result.editUrl,
        revision: result.revision,
      }, { status: 201, headers });
    } catch (error) {
      return appErrorResponse(
        error instanceof AppError
          ? error
          : new AppError(
              "INTERNAL_ERROR",
              "Could not join the appointment.",
              { cause: error },
            ),
      );
    }
  };
}
