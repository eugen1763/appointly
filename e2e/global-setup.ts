import { mkdir } from "node:fs/promises";

import { request } from "@playwright/test";
import { z } from "zod";

import {
  CO_ORGANIZER_IDENTITY,
  E2E_BASE_URL,
  OWNER_IDENTITY,
} from "./auth-identities";
import type { E2EAuthIdentity } from "./auth-identities";

const SESSION_COOKIE_NAME = "better-auth.session_token";
const healthResponseSchema = z
  .object({ status: z.literal("ok") })
  .strict();
const signUpResponseSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        email: z.string(),
        name: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

function parseJson(body: string, source: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause) {
    throw new Error(`${source} returned malformed JSON`, { cause });
  }
}

async function confirmHealth(): Promise<void> {
  const context = await request.newContext({ baseURL: E2E_BASE_URL });

  try {
    const response = await context.get("/api/health");
    const responseBody = await response.text();

    if (response.status() !== 200) {
      throw new Error(
        `E2E health check failed: expected status 200, received ${response.status()} (${response.statusText()}): ${responseBody}`,
      );
    }

    const health = healthResponseSchema.safeParse(
      parseJson(responseBody, "E2E health check"),
    );
    if (!health.success) {
      throw new Error(
        `E2E health check returned unexpected JSON: expected {"status":"ok"}, received ${responseBody}`,
      );
    }
  } finally {
    await context.dispose();
  }
}

function assertCreatedIdentity(
  payload: unknown,
  identity: E2EAuthIdentity,
): void {
  const result = signUpResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      `E2E sign-up for ${identity.email} returned malformed user JSON: ${result.error.issues.map(({ message, path }) => `${path.join(".")}: ${message}`).join("; ")}`,
    );
  }

  const { user } = result.data;

  if (user.email !== identity.email || user.name !== identity.name) {
    throw new Error(
      `E2E sign-up identity mismatch for ${identity.email}: expected ${identity.name} <${identity.email}>, received ${String(user.name)} <${String(user.email)}>`,
    );
  }
}

async function createAuthenticatedUser(
  identity: E2EAuthIdentity,
): Promise<void> {
  const context = await request.newContext({ baseURL: E2E_BASE_URL });

  try {
    const response = await context.post("/api/auth/sign-up/email", {
      data: {
        name: identity.name,
        email: identity.email,
        password: identity.password,
      },
    });
    const responseBody = await response.text();

    if (!response.ok()) {
      throw new Error(
        `E2E sign-up failed for ${identity.email}: received ${response.status()} (${response.statusText()}): ${responseBody}`,
      );
    }

    assertCreatedIdentity(
      parseJson(responseBody, `E2E sign-up for ${identity.email}`),
      identity,
    );

    const storageState = await context.storageState();
    const sessionCookie = storageState.cookies.find(
      ({ name }) => name === SESSION_COOKIE_NAME,
    );
    if (!sessionCookie || sessionCookie.value.length === 0) {
      throw new Error(
        `E2E sign-up for ${identity.email} did not set the required ${SESSION_COOKIE_NAME} cookie`,
      );
    }

    await context.storageState({ path: identity.storageStatePath });
  } finally {
    await context.dispose();
  }
}

export default async function globalSetup(): Promise<void> {
  await mkdir(".tmp", { recursive: true });
  await confirmHealth();
  await createAuthenticatedUser(OWNER_IDENTITY);
  await createAuthenticatedUser(CO_ORGANIZER_IDENTITY);
}
