import { readServerSession } from "../../../../../../lib/auth";
import { getEnv } from "../../../../../../lib/env";
import { readGuestSessionCookie } from "../../../../../../features/appointments/server/guest-session-storage";
import { deleteOption } from "../../../../../../features/appointments/server/options";
import {
  productionDeleteConfirmationDigester,
  productionGuestTokenDigester,
  productionRateKeyDigester,
} from "../../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../../features/appointments/server/production-service-context";
import { createDeleteOptionHandler } from "./route-handler";

export const runtime = "nodejs";

const env = getEnv();

export const DELETE = createDeleteOptionHandler({
  appOrigin: env.appOrigin,
  context: productionServiceContext,
  tokenDigester: productionGuestTokenDigester,
  rateKeyDigester: productionRateKeyDigester,
  confirmationDigester: productionDeleteConfirmationDigester,
  readSession: () => readServerSession(),
  readGuestSessionToken: readGuestSessionCookie,
  deleteOption,
});
