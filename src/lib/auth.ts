import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { headers } from "next/headers";

import { getDatabaseConnection } from "../db";
import { authDatabaseSchema, buildAuthOptions } from "./auth-config";
import { getEnv } from "./env";
import {
  extractManagerIdentity,
  type ManagerIdentity,
} from "./auth-session";

const env = getEnv();
const database = drizzleAdapter(getDatabaseConnection().db, {
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

export async function readServerSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function readServerManagerIdentity(): Promise<ManagerIdentity> {
  return extractManagerIdentity(await readServerSession());
}
