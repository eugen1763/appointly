import {
  CO_ORGANIZER_IDENTITY,
  OWNER_IDENTITY,
} from "./auth-identities";
import { expect, test } from "./fixtures";

test("owner and co-organizer fixtures keep independent authenticated sessions", async ({
  ownerPage,
  coOrganizerPage,
}) => {
  const [ownerResponse, coOrganizerResponse] = await Promise.all([
    ownerPage.goto("/api/auth/get-session"),
    coOrganizerPage.goto("/api/auth/get-session"),
  ]);

  if (!ownerResponse || !coOrganizerResponse) {
    throw new Error("Authenticated fixture session navigation returned no response");
  }

  expect(ownerResponse.status()).toBe(200);
  expect(coOrganizerResponse.status()).toBe(200);

  await expect(ownerResponse.json()).resolves.toMatchObject({
    user: { email: OWNER_IDENTITY.email },
  });
  await expect(coOrganizerResponse.json()).resolves.toMatchObject({
    user: { email: CO_ORGANIZER_IDENTITY.email },
  });
});
