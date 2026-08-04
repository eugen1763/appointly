import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { readServerSession } from "../../../../../lib/auth";
import { getEnv } from "../../../../../lib/env";
import {
  createManagersGetHandler,
  createManagersPostHandler,
} from "./route-handler";

export const runtime = "nodejs";


export const GET = createManagersGetHandler({
  context: productionServiceContext,
  readSession: () => readServerSession(),
});

export const POST = createManagersPostHandler({
  appOrigin: getEnv().appOrigin,
  context: productionServiceContext,
  readSession: () => readServerSession(),
});
