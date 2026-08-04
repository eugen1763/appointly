import {
  addOptionRequestSchema,
  appointmentParamsSchema,
} from "../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../features/appointments/http-errors";
import type {
  AddOptionInput,
  AddOptionResult,
} from "../../../../../features/appointments/server/options";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../../../lib/auth-session";
import type {
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../lib/security";

export type AddOptionSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type AddOptionGuestSessionReader = (
  request: Request,
) => string | null;

export type AddOptionCommand = (
  context: ServiceContext,
  input: AddOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
) => AddOptionResult;

export interface AddOptionPostDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly tokenDigester: GuestTokenDigester;
  readonly rateKeyDigester: RateKeyDigester;
  readonly readSession: AddOptionSessionReader;
  readonly readGuestSessionToken: AddOptionGuestSessionReader;
  readonly addOption: AddOptionCommand;
}

export interface AddOptionRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type AddOptionPostHandler = (
  request: Request,
  routeContext: AddOptionRouteContext,
) => Promise<Response>;

export function createAddOptionPostHandler(
  dependencies: AddOptionPostDependencies,
): AddOptionPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        appointmentParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        addOptionRequestSchema,
        await readJsonRequest(request),
      );
      const session = await dependencies.readSession(request);
      const result = dependencies.addOption(dependencies.context, {
        publicId: params.publicId,
        participantId: body.participantId,
        timeZone: body.timeZone,
        option: body.option,
        identity: session === null ? null : { userId: session.user.id },
        guestSessionToken: dependencies.readGuestSessionToken(request),
      }, dependencies.tokenDigester, dependencies.rateKeyDigester);

      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
