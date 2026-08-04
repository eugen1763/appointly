import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { readServerSession } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";
import { createReopenAppointmentPostHandler } from "./route-handler";

export const runtime = "nodejs";

export const POST = createReopenAppointmentPostHandler({
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
});
