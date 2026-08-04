import {
  appointmentParamsSchema,
  guestAccessRequestSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import { exchangeGuestAccess } from "../../../../../features/appointments/server/guest-access";
import {
  readGuestSessionCookie,
  serializeGuestSessionCookie,
} from "../../../../../features/appointments/server/guest-session-storage";
import {
  assertExactRequestOrigin,
} from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import type { GuestTokenDigester } from "../../../../../lib/security";

export interface GuestAccessRouteDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly tokenDigester: GuestTokenDigester;
}

export interface GuestAccessRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type GuestAccessPostHandler = (
  request: Request,
  routeContext: GuestAccessRouteContext,
) => Promise<Response>;

async function readUntrustedJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function createGuestAccessPostHandler(
  dependencies: GuestAccessRouteDependencies,
): GuestAccessPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const rawParams = await routeContext.params;
      const rawBody = await readUntrustedJson(request);
      const params = appointmentParamsSchema.safeParse(rawParams);
      const body = guestAccessRequestSchema.safeParse(rawBody);
      const result = exchangeGuestAccess(dependencies.context, {
        publicId: params.success ? params.data.publicId : undefined,
        participantId: body.success ? body.data.participantId : undefined,
        token: body.success ? body.data.token : undefined,
        guestSessionToken: readGuestSessionCookie(request),
      }, dependencies.tokenDigester);
      const headers = new Headers();
      if (result.sessionToken !== null) {
        headers.set(
          "Set-Cookie",
          serializeGuestSessionCookie(result.sessionToken, dependencies.appOrigin),
        );
      }
      return Response.json(
        { participantId: result.participantId },
        { status: 200, headers },
      );
    } catch (error) {
      return appErrorResponse(
        error instanceof AppError
          ? error
          : new AppError(
              "INTERNAL_ERROR",
              "Could not open the private edit link.",
              { cause: error },
            ),
      );
    }
  };
}
