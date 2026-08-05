import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { headers } from "next/headers";

import { getDatabaseConnection } from "../db";
import { user } from "../db/auth-schema";
import { authDatabaseSchema, buildAuthOptions } from "./auth-config";
import { getEnv } from "./env";
import {
  extractManagerIdentity,
  type ManagerIdentity,
} from "./auth-session";

const env = getEnv();
const connection = getDatabaseConnection();
const database = drizzleAdapter(connection.db, {
  provider: "sqlite",
  schema: authDatabaseSchema,
});

export const auth = betterAuth(
  buildAuthOptions({
    env,
    database,
    nodeEnv: process.env.NODE_ENV,
    e2eAuth: process.env.E2E_AUTH,
  }),
);

export { extractManagerIdentity } from "./auth-session";

export const INTERNAL_ORGANIZER_IDENTITY = Object.freeze({
  userId: "appointly-internal-organizer",
  email: "organizer@appointly.local",
  name: "Internal organizer",
} satisfies ManagerIdentity);

function ensureInternalOrganizer(): void {
  connection.db.insert(user).values({
    id: INTERNAL_ORGANIZER_IDENTITY.userId,
    email: INTERNAL_ORGANIZER_IDENTITY.email,
    name: INTERNAL_ORGANIZER_IDENTITY.name,
    emailVerified: true,
  }).onConflictDoNothing().run();
}

export async function readServerSession() {
  if (!env.GOOGLE_AUTH_ENABLED) {
    ensureInternalOrganizer();
    return {
      user: {
        id: INTERNAL_ORGANIZER_IDENTITY.userId,
        email: INTERNAL_ORGANIZER_IDENTITY.email,
        name: INTERNAL_ORGANIZER_IDENTITY.name,
      },
    };
  }
  return auth.api.getSession({ headers: await headers() });
}

export async function readServerManagerIdentity(): Promise<ManagerIdentity> {
  return extractManagerIdentity(await readServerSession());
}
