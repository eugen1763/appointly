import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  CO_ORGANIZER_IDENTITY,
  E2E_BASE_URL,
  OWNER_IDENTITY,
} from "./auth-identities";

interface AuthenticatedPageFixtures {
  ownerPage: Page;
  coOrganizerPage: Page;
}

export const test = base.extend<AuthenticatedPageFixtures>({
  ownerPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: E2E_BASE_URL,
      storageState: OWNER_IDENTITY.storageStatePath,
    });

    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
  coOrganizerPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      baseURL: E2E_BASE_URL,
      storageState: CO_ORGANIZER_IDENTITY.storageStatePath,
    });

    try {
      await use(await context.newPage());
    } finally {
      await context.close();
    }
  },
});

export { expect };
