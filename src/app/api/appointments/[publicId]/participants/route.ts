import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import {
  productionGuestTokenDigester,
  productionRateKeyDigester,
} from "../../../../../features/appointments/server/production-guest-token-digester";
import { readServerSession } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";
import { createParticipantPostHandler } from "./route-handler";

export const runtime = "nodejs";
const env = getEnv();


export const POST = createParticipantPostHandler({
  appOrigin: env.appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
  tokenDigester: productionGuestTokenDigester,
  rateKeyDigester: productionRateKeyDigester,
  trustProxy: env.TRUST_PROXY,
});
