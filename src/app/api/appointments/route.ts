import { createAppointment } from "../../../features/appointments/server/create-appointment";
import { productionServiceContext } from "../../../features/appointments/server/production-service-context";
import { readServerSession } from "../../../lib/auth";
import { getEnv } from "../../../lib/env";
import { createAppointmentsPostHandler } from "./route-handler";

export const runtime = "nodejs";

export const POST = createAppointmentsPostHandler({
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
  createAppointment,
});
