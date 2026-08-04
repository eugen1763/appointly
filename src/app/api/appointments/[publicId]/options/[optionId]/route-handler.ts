import {
  deleteOptionRequestSchema,
  optionParamsSchema,
} from "../../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../../features/appointments/http-errors";
import type {
  DeleteOptionInput,
  DeleteOptionResult,
} from "../../../../../../features/appointments/server/options";
import {
  assertExactRequestOrigin,
  parseRouteValue,
  readJsonRequest,
} from "../../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../../../../lib/auth-session";
import type {
  DeleteConfirmationDigester,
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../../lib/security";

export type DeleteOptionSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type DeleteOptionGuestSessionReader = (
  request: Request,
) => string | null;

export type DeleteOptionCommand = (
  context: ServiceContext,
  input: DeleteOptionInput,
  tokenDigester: GuestTokenDigester,
  rateKeyDigester: RateKeyDigester,
  confirmationDigester: DeleteConfirmationDigester,
) => DeleteOptionResult;

export interface DeleteOptionDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly tokenDigester: GuestTokenDigester;
  readonly rateKeyDigester: RateKeyDigester;
  readonly confirmationDigester: DeleteConfirmationDigester;
  readonly readSession: DeleteOptionSessionReader;
  readonly readGuestSessionToken: DeleteOptionGuestSessionReader;
  readonly deleteOption: DeleteOptionCommand;
}

export interface DeleteOptionRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type DeleteOptionHandler = (
  request: Request,
  routeContext: DeleteOptionRouteContext,
) => Promise<Response>;

export function createDeleteOptionHandler(
  dependencies: DeleteOptionDependencies,
): DeleteOptionHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        optionParamsSchema,
        await routeContext.params,
      );
      const body = parseRouteValue(
        deleteOptionRequestSchema,
        await readJsonRequest(request),
      );
      const session = await dependencies.readSession(request);
      const result = dependencies.deleteOption(dependencies.context, {
        publicId: params.publicId,
        optionId: params.optionId,
        participantId: body.participantId,
        confirmationToken: body.confirmationToken,
        identity: session === null ? null : { userId: session.user.id },
        guestSessionToken: dependencies.readGuestSessionToken(request),
      }, dependencies.tokenDigester, dependencies.rateKeyDigester, dependencies.confirmationDigester);
      return Response.json(result, { status: 200 });
    } catch (error) {
      if (error instanceof AppError) return appErrorResponse(error);
      throw error;
    }
  };
}
