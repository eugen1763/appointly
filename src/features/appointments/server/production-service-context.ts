import { appointmentEventPublisher } from "./event-publisher";
import { createProductionServiceContext } from "./service-context";

export const productionServiceContext = createProductionServiceContext(
  appointmentEventPublisher,
);
