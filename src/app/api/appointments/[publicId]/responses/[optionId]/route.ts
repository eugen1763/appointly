import { readServerSession } from "../../../../../../lib/auth";
import { getEnv } from "../../../../../../lib/env";
import { readGuestSessionCookie } from "../../../../../../features/appointments/server/guest-session-storage";
import {
  productionGuestTokenDigester,
  productionRateKeyDigester,
} from "../../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../../features/appointments/server/production-service-context";
import { putResponse } from "../../../../../../features/appointments/server/responses";
import { createPutResponseHandler } from "./route-handler";

export const runtime = "nodejs";

const env = getEnv();

export const PUT = createPutResponseHandler({
  appOrigin: env.appOrigin,
  context: productionServiceContext,
  tokenDigester: productionGuestTokenDigester,
  rateKeyDigester: productionRateKeyDigester,
  readSession: () => readServerSession(),
  readGuestSessionToken: readGuestSessionCookie,
  putResponse,
});
