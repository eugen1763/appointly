import { productionServiceContext } from "../../../../features/appointments/server/production-service-context";
import { readServerSession } from "../../../../lib/auth";
import { getEnv } from "../../../../lib/env";
import {
  createAppointmentDeleteHandler,
  createAppointmentPatchHandler,
} from "./route-handler";

export const runtime = "nodejs";

const dependencies = {
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
};

export const DELETE = createAppointmentDeleteHandler(dependencies);
export const PATCH = createAppointmentPatchHandler(dependencies);
