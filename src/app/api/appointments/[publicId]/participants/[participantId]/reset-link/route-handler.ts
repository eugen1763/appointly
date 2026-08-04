import { participantParamsSchema } from "../../../../../../../features/appointments/contracts";
import {
  AppError,
  appErrorResponse,
} from "../../../../../../../features/appointments/http-errors";
import type {
  ResetParticipantLinkInput,
  ResetParticipantLinkResult,
} from "../../../../../../../features/appointments/server/guest-access";
import {
  assertExactRequestOrigin,
  parseRouteValue,
} from "../../../../../../../features/appointments/server/route-support";
import type { ServiceContext } from "../../../../../../../features/appointments/server/service-context";
import {
  extractManagerIdentity,
  type ManagerSession,
} from "../../../../../../../lib/auth-session";
import type { GuestTokenDigester } from "../../../../../../../lib/security";

export type ResetParticipantLinkSessionReader = (
  request: Request,
) => Promise<ManagerSession | null>;

export type ResetParticipantLinkCommand = (
  context: ServiceContext,
  input: ResetParticipantLinkInput,
  tokenDigester: GuestTokenDigester,
) => ResetParticipantLinkResult;

export interface ResetParticipantLinkDependencies {
  readonly appOrigin: string;
  readonly context: ServiceContext;
  readonly readSession: ResetParticipantLinkSessionReader;
  readonly tokenDigester: GuestTokenDigester;
  readonly resetParticipantLink: ResetParticipantLinkCommand;
}

export interface ResetParticipantLinkRouteContext {
  readonly params: Promise<Record<string, string>>;
}

export type ResetParticipantLinkPostHandler = (
  request: Request,
  routeContext: ResetParticipantLinkRouteContext,
) => Promise<Response>;

async function assertNoRequestBody(request: Request): Promise<void> {
  if ((await request.text()).length > 0) {
    throw new AppError("VALIDATION_FAILED", "This request does not accept a body.", {
      fieldErrors: { body: ["Request body must be empty."] },
    });
  }
}

export function createResetParticipantLinkPostHandler(
  dependencies: ResetParticipantLinkDependencies,
): ResetParticipantLinkPostHandler {
  return async (request, routeContext) => {
    try {
      assertExactRequestOrigin(request, dependencies.appOrigin);
      const params = parseRouteValue(
        participantParamsSchema,
        await routeContext.params,
      );
      await assertNoRequestBody(request);
      const identity = extractManagerIdentity(
        await dependencies.readSession(request),
      );
      const result = dependencies.resetParticipantLink(
        dependencies.context,
        {
          publicId: params.publicId,
          participantId: params.participantId,
          managerUserId: identity.userId,
        },
        dependencies.tokenDigester,
      );
      return Response.json(result, { status: 200 });
    } catch (error) {
      return appErrorResponse(
        error instanceof AppError
          ? error
          : new AppError(
              "INTERNAL_ERROR",
              "Could not reset the private edit link.",
              { cause: error },
            ),
      );
    }
  };
}

