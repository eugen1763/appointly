import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { readServerSession } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";
import { createManagerParticipantPostHandler } from "./route-handler";

export const runtime = "nodejs";

export const POST = createManagerParticipantPostHandler({
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
});
