import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vitest";

import {
  authDatabaseSchema,
  buildAuthOptions,
  isE2EAuthEnabled,
  shouldUseSecureCookies,
} from "./auth-config";

const env = {
  APP_URL: "https://appointments.example",
  BETTER_AUTH_SECRET: "better-auth-secret",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
};

describe("isE2EAuthEnabled", () => {
  it.each([
    { nodeEnv: "development", e2eAuth: "1", expected: true },
    { nodeEnv: "test", e2eAuth: "1", expected: true },
    { nodeEnv: "production", e2eAuth: "1", expected: false },
    { nodeEnv: "development", e2eAuth: "true", expected: false },
    { nodeEnv: "development", e2eAuth: undefined, expected: false },
  ])(
    "returns $expected for NODE_ENV=$nodeEnv and E2E_AUTH=$e2eAuth",
    ({ nodeEnv, e2eAuth, expected }) => {
      expect(isE2EAuthEnabled(nodeEnv, e2eAuth)).toBe(expected);
    },
  );
});

describe("shouldUseSecureCookies", () => {
  it.each([
    ["https://appointments.example", true],
    ["http://localhost:3000", false],
  ] as const)("returns %s only for an HTTPS app URL", (appUrl, expected) => {
    expect(shouldUseSecureCookies(appUrl)).toBe(expected);
  });
});

describe("authDatabaseSchema", () => {
  it("contains only the four generated Better Auth tables", () => {
    expect(Object.keys(authDatabaseSchema)).toEqual([
      "user",
      "session",
      "account",
      "verification",
    ]);
  });
});

describe("buildAuthOptions", () => {
  it("passes the exact app, Google, database, password, and cookie settings", () => {
    const database = {} as NonNullable<BetterAuthOptions["database"]>;

    expect(
      buildAuthOptions({
        env,
        database,
        nodeEnv: "production",
        e2eAuth: "1",
      }),
    ).toEqual({
      baseURL: "https://appointments.example",
      secret: "better-auth-secret",
      trustedOrigins: ["https://appointments.example"],
      database,
      socialProviders: {
        google: {
          clientId: "google-client-id",
          clientSecret: "google-client-secret",
        },
      },
      emailAndPassword: { enabled: false },
      advanced: { useSecureCookies: true },
    });
  });
});
