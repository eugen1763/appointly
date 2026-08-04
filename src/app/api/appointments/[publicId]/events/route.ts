import { appointmentEventPublisher } from "../../../../../features/appointments/server/event-publisher";
import { findAppointmentEventTarget } from "../../../../../features/appointments/server/event-stream";
import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { createAppointmentEventsGetHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const GET = createAppointmentEventsGetHandler({
  context: productionServiceContext,
  findEventTarget: findAppointmentEventTarget,
  subscriber: appointmentEventPublisher,
});
