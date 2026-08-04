import { productionGuestTokenDigester } from "../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { getEnv } from "../../../../../lib/env";
import { createGuestAccessPostHandler } from "./route-handler";

export const runtime = "nodejs";

const env = getEnv();

export const POST = createGuestAccessPostHandler({
  appOrigin: env.appOrigin,
  context: productionServiceContext,
  tokenDigester: productionGuestTokenDigester,
});
