import { readServerSession } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";
import { readGuestSessionCookie } from "../../../../../features/appointments/server/guest-session-storage";
import { addOption } from "../../../../../features/appointments/server/options";
import {
  productionGuestTokenDigester,
  productionRateKeyDigester,
} from "../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { createAddOptionPostHandler } from "./route-handler";

export const runtime = "nodejs";

const env = getEnv();

export const POST = createAddOptionPostHandler({
  appOrigin: env.appOrigin,
  context: productionServiceContext,
  tokenDigester: productionGuestTokenDigester,
  rateKeyDigester: productionRateKeyDigester,
  readSession: () => readServerSession(),
  readGuestSessionToken: readGuestSessionCookie,
  addOption,
});
