import { readServerSession } from "../../../../../../../lib/auth";
import { resetParticipantLink } from "../../../../../../../features/appointments/server/guest-access";
import { productionGuestTokenDigester } from "../../../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../../../features/appointments/server/production-service-context";
import { getEnv } from "../../../../../../../lib/env";
import { createResetParticipantLinkPostHandler } from "./route-handler";

export const runtime = "nodejs";

export const POST = createResetParticipantLinkPostHandler({
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
  tokenDigester: productionGuestTokenDigester,
  resetParticipantLink,
});
