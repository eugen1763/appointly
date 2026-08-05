import type { BetterAuthOptions } from "better-auth";

import { account, session, user, verification } from "../db/auth-schema";

export interface AuthConfigEnvironment {
  readonly APP_URL: string;
  readonly BETTER_AUTH_SECRET: string;
  readonly GOOGLE_CLIENT_ID: string;
  readonly GOOGLE_CLIENT_SECRET: string;
  readonly GOOGLE_AUTH_ENABLED: boolean;
}

export const authDatabaseSchema = {
  user,
  session,
  account,
  verification,
};

export function isE2EAuthEnabled(
  nodeEnv: string | undefined,
  e2eAuth: string | undefined,
): boolean {
  return nodeEnv !== "production" && e2eAuth === "1";
}

export function shouldUseSecureCookies(appUrl: string): boolean {
  return new URL(appUrl).protocol === "https:";
}

export interface BuildAuthOptionsInput {
  readonly env: AuthConfigEnvironment;
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly nodeEnv: string | undefined;
  readonly e2eAuth: string | undefined;
}

export function buildAuthOptions({
  env,
  database,
  nodeEnv,
  e2eAuth,
}: BuildAuthOptionsInput) {
  return {
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database,
    socialProviders: env.GOOGLE_AUTH_ENABLED
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
    emailAndPassword: {
      enabled: isE2EAuthEnabled(nodeEnv, e2eAuth),
    },
    advanced: {
      useSecureCookies: shouldUseSecureCookies(env.APP_URL),
    },
  } satisfies BetterAuthOptions;
}
