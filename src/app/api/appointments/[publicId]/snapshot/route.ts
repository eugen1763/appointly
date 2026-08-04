import { readServerSession } from "../../../../../lib/auth";
import { productionGuestTokenDigester } from "../../../../../features/appointments/server/production-guest-token-digester";
import { productionServiceContext } from "../../../../../features/appointments/server/production-service-context";
import { getAppointmentSnapshot } from "../../../../../features/appointments/server/snapshot";
import { readGuestSessionCookie } from "../../../../../features/appointments/server/guest-session-storage";
import { createAppointmentSnapshotGetHandler } from "./route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createAppointmentSnapshotGetHandler({
  context: productionServiceContext,
  tokenDigester: productionGuestTokenDigester,
  readSession: () => readServerSession(),
  readGuestSessionToken: readGuestSessionCookie,
  getSnapshot: getAppointmentSnapshot,
});
