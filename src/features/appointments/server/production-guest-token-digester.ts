import { getEnv } from "../../../lib/env";
import {
  createDeleteConfirmationDigester,
  createGuestTokenDigester,
  createRateKeyDigester,
} from "../../../lib/security";

const guestMasterKey = Buffer.from(getEnv().GUEST_TOKEN_SECRET, "base64url");

export const productionGuestTokenDigester = createGuestTokenDigester(guestMasterKey);
export const productionRateKeyDigester = createRateKeyDigester(guestMasterKey);
export const productionDeleteConfirmationDigester =
  createDeleteConfirmationDigester(guestMasterKey);
