import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      E2E_AUTH: "1",
      DATABASE_PATH: ".tmp/e2e.sqlite",
      APP_URL: "http://127.0.0.1:3000",
      BETTER_AUTH_SECRET:
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
      GUEST_TOKEN_SECRET:
        "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8",
      GOOGLE_CLIENT_ID: "appointly-e2e-google-client",
      GOOGLE_CLIENT_SECRET: "appointly-e2e-google-secret",
      TRUST_PROXY: "false",
    },
  },
});
