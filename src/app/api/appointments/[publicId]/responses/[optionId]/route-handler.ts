import {
  optionParamsSchema,
  putResponseRequestSchema,
} from "../../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../../features/appointments/http-errors";
import type {
  PutResponseInput,
  PutResponseResult,
} from "../../../../../../features/appointments/server/responses";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../../../../lib/auth-session";
import type {
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../../lib/security";

export type PutResponseSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type PutResponseGuestSessionReader = (
  request: Request,
) => string | null;

export type PutResponseCommand = (
  context: ServiceContext,
  input: PutResponseInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
) => PutResponseResult;

export interface PutResponseDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly tokenDigester: GuestTokenDigester;
  readonly rateKeyDigester: RateKeyDigester;
  readonly readSession: PutResponseSessionReader;
  readonly readGuestSessionToken: PutResponseGuestSessionReader;
  readonly putResponse: PutResponseCommand;
}

export interface PutResponseRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type PutResponseHandler = (
  request: Request,
  routeContext: PutResponseRouteContext,
) => Promise<Response>;

export function createPutResponseHandler(
  dependencies: PutResponseDependencies,
): PutResponseHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        optionParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        putResponseRequestSchema,
        await readJsonRequest(request),
      );
      const session = await dependencies.readSession(request);
      const result = dependencies.putResponse(dependencies.context, {
        publicId: params.publicId,
        optionId: params.optionId,
        participantId: body.participantId,
        value: body.value,
        identity: session === null ? null : { userId: session.user.id },
        guestSessionToken: dependencies.readGuestSessionToken(request),
      }, dependencies.tokenDigester, dependencies.rateKeyDigester);
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}

