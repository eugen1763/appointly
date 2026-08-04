export interface E2EAuthIdentity {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly storageStatePath: string;
}

export const E2E_BASE_URL = "http://127.0.0.1:3000";

export const OWNER_IDENTITY = {
  name: "Olivia Owner",
  email: "owner@appointly.test",
  password: "Owner-Playwright!43",
  storageStatePath: ".tmp/e2e-owner-storage-state.json",
} as const satisfies E2EAuthIdentity;

export const CO_ORGANIZER_IDENTITY = {
  name: "Casey Co-organizer",
  email: "co-organizer@appointly.test",
  password: "CoOrganizer-Playwright!43",
  storageStatePath: ".tmp/e2e-co-organizer-storage-state.json",
} as const satisfies E2EAuthIdentity;
