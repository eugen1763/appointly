import { isIP } from "node:net";

import { z, type ZodType } from "zod";

import { AppError } from "../http-errors";

export const DIRECT_CLIENT_RATE_KEY = "direct-client";

export function resolveJoinClientKey(
  request: Request,
  trustProxy: boolean,
): string {
  if (!trustProxy) return DIRECT_CLIENT_RATE_KEY;
  const leftmost = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return leftmost && isIP(leftmost) !== 0
    ? leftmost
    : DIRECT_CLIENT_RATE_KEY;
}

export function assertExactRequestOrigin(
  request: Request,
  appOrigin: string,
): void {
  if (request.headers.get("origin") !== appOrigin) {
    throw new AppError(
      "ORIGIN_MISMATCH",
      "The request origin does not match this application.",
    );
  }
}

export function parseRouteValue<Output>(
  schema: ZodType<Output>,
  input: unknown,
): Output {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flattened = z.flattenError(result.error);
    const fieldErrors = Object.fromEntries(
      Object.entries(flattened.fieldErrors).filter(
        (entry): entry is [string, string[]] => entry[1] !== undefined,
      ),
    );
    throw new AppError("VALIDATION_FAILED", "Check the submitted fields.", {
      fieldErrors,
    });
  }
  return result.data;
}

export async function readJsonRequest(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (cause) {
    throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON.", {
      fieldErrors: { body: ["Request body must be valid JSON."] },
      cause,
    });
  }
}
