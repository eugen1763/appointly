import { describe, expect, it, vi } from "vitest";

import type { ServiceContext } from "../../../../../../features/appointments/server/service-context";
import { AppError } from "../../../../../../features/appointments/http-errors";
import type {
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../../lib/security";
import {
  createPutResponseHandler,
  type PutResponseDependencies,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const OPTION_ID = "00000000-0000-4000-8000-000000000001";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";
const context = {} as ServiceContext;
const tokenDigester = {} as GuestTokenDigester;
const rateKeyDigester = {} as RateKeyDigester;

function dependencies(
  overrides: Partial<PutResponseDependencies> = {},
): PutResponseDependencies {
  return {
    appOrigin: APP_ORIGIN,
    context,
    tokenDigester,
    rateKeyDigester,
    readSession: vi.fn().mockResolvedValue(null),
    readGuestSessionToken: vi.fn(() => "guest-token"),
    putResponse: vi.fn<PutResponseDependencies["putResponse"]>(
      () => ({ value: "YES", revision: 2 }),
    ),
    ...overrides,
  };
}

function put(
  deps: PutResponseDependencies,
  options: {
    origin?: string;
    params?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.origin !== "missing") headers.set("Origin", options.origin ?? APP_ORIGIN);
  return createPutResponseHandler(deps)(new Request(
    `${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/responses/${OPTION_ID}`,
    {
      method: "PUT",
      headers,
      body: options.body ?? JSON.stringify({ participantId: PARTICIPANT_ID, value: "YES" }),
    },
  ), {
    params: Promise.resolve(options.params ?? { publicId: PUBLIC_ID, optionId: OPTION_ID }),
  });
}

describe("createPutResponseHandler", () => {
  it("passes validated actor inputs to the service", async () => {
    const putResponse = vi.fn(() => ({ value: "NO" as const, revision: 7 }));
    const deps = dependencies({
      putResponse,
      readSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", name: "User" },
      }),
    });

    const response = await put(deps, {
      body: JSON.stringify({ participantId: PARTICIPANT_ID, value: "NO" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: "NO", revision: 7 });
    expect(putResponse).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      optionId: OPTION_ID,
      participantId: PARTICIPANT_ID,
      value: "NO",
      identity: { userId: "user-1" },
      guestSessionToken: "guest-token",
    }, tokenDigester, rateKeyDigester);
  });

  it.each(["YES", "NO", null])("accepts response value %s", async (value) => {
    const putResponse = vi.fn<PutResponseDependencies["putResponse"]>(
      () => ({ value: value as "YES" | "NO" | null, revision: 2 }),
    );
    const response = await put(dependencies({ putResponse }), {
      body: JSON.stringify({ participantId: PARTICIPANT_ID, value }),
    });

    expect(response.status).toBe(200);
    expect(putResponse).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined, "ORIGIN_MISMATCH"],
    ["https://evil.example", "ORIGIN_MISMATCH"],
  ])("checks the exact Origin before all other work", async (origin, code) => {
    const order: string[] = [];
    const deps = dependencies({
      readSession: vi.fn(async () => {
        order.push("session");
        return null;
      }),
      putResponse: vi.fn<PutResponseDependencies["putResponse"]>(() => {
        order.push("service");
        return { value: "YES", revision: 2 };
      }),
    });

    const response = await put(deps, {
      origin: origin ?? "missing",
      params: { publicId: "bad", optionId: "bad" },
      body: "not-json",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(order).toEqual([]);
  });

  it("rejects invalid params and body before session work", async () => {
    const readSession = vi.fn().mockResolvedValue(null);
    const deps = dependencies({ readSession });

    const badParams = await put(deps, { params: { publicId: "bad", optionId: "bad" } });
    const badBody = await put(deps, { body: JSON.stringify({ participantId: PARTICIPANT_ID, value: "MAYBE" }) });

    expect(badParams.status).toBe(400);
    expect(badBody.status).toBe(400);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("returns Retry-After only for rate limiting", async () => {
    const limited = await put(dependencies({
      putResponse: vi.fn(() => {
        throw new AppError("RATE_LIMITED", "Too many requests. Try again later.", {
          retryAfterSeconds: 17,
        });
      }),
    }));
    const forbidden = await put(dependencies({
      putResponse: vi.fn(() => {
        throw new AppError("FORBIDDEN", "Participant access is required.");
      }),
    }));

    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("17");
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("retry-after")).toBeNull();
  });
});
