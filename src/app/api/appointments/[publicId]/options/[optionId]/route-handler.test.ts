import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../../../../features/appointments/http-errors";
import type { ServiceContext } from "../../../../../../features/appointments/server/service-context";
import type {
  DeleteConfirmationDigester,
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../../lib/security";
import {
  createDeleteOptionHandler,
  type DeleteOptionDependencies,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const OPTION_ID = "00000000-0000-4000-8000-000000000001";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";
const CONFIRMATION_TOKEN = "A".repeat(43);
const context = {} as ServiceContext;
const tokenDigester = {} as GuestTokenDigester;
const rateKeyDigester = {} as RateKeyDigester;
const confirmationDigester = {} as DeleteConfirmationDigester;

function dependencies(
  overrides: Partial<DeleteOptionDependencies> = {},
): DeleteOptionDependencies {
  return {
    appOrigin: APP_ORIGIN,
    context,
    tokenDigester,
    rateKeyDigester,
    confirmationDigester,
    readSession: vi.fn().mockResolvedValue(null),
    readGuestSessionToken: vi.fn(() => "guest-token"),
    deleteOption: vi.fn<DeleteOptionDependencies["deleteOption"]>(
      () => ({ revision: 2 }),
    ),
    ...overrides,
  };
}

function deleteRequest(
  deps: DeleteOptionDependencies,
  options: {
    origin?: string;
    params?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.origin !== "missing") {
    headers.set("Origin", options.origin ?? APP_ORIGIN);
  }

  return createDeleteOptionHandler(deps)(new Request(
    `${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/options/${OPTION_ID}`,
    {
      method: "DELETE",
      headers,
      body: options.body ?? JSON.stringify({ participantId: PARTICIPANT_ID }),
    },
  ), {
    params: Promise.resolve(options.params ?? {
      publicId: PUBLIC_ID,
      optionId: OPTION_ID,
    }),
  });
}

const confirmationDetails = {
  count: 2,
  names: ["Ada", "Grace"],
  token: CONFIRMATION_TOKEN,
};

describe("createDeleteOptionHandler", () => {
  it.each([
    ["missing", "ORIGIN_MISMATCH"],
    ["https://evil.example", "ORIGIN_MISMATCH"],
  ])("checks exact Origin %s before all other work", async (origin, code) => {
    const order: string[] = [];
    const deps = dependencies({
      readSession: vi.fn(async () => {
        order.push("session");
        return null;
      }),
      deleteOption: vi.fn<DeleteOptionDependencies["deleteOption"]>(() => {
        order.push("service");
        return { revision: 2 };
      }),
    });

    const response = await deleteRequest(deps, {
      origin,
      params: { publicId: "bad", optionId: "bad" },
      body: "not-json",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(order).toEqual([]);
  });

  it.each([
    [{ publicId: "bad", optionId: OPTION_ID }, JSON.stringify({ participantId: PARTICIPANT_ID })],
    [{ publicId: PUBLIC_ID, optionId: "bad" }, JSON.stringify({ participantId: PARTICIPANT_ID })],
    [{ publicId: PUBLIC_ID, optionId: OPTION_ID, extra: "field" }, JSON.stringify({ participantId: PARTICIPANT_ID })],
    [{ publicId: PUBLIC_ID, optionId: OPTION_ID }, "not-json"],
    [{ publicId: PUBLIC_ID, optionId: OPTION_ID }, JSON.stringify({ participantId: "bad" })],
    [{ publicId: PUBLIC_ID, optionId: OPTION_ID }, JSON.stringify({ participantId: PARTICIPANT_ID, extra: true })],
    [{ publicId: PUBLIC_ID, optionId: OPTION_ID }, JSON.stringify({ participantId: PARTICIPANT_ID, confirmationToken: "not-canonical" })],
  ])("strictly rejects invalid params or body before session work %#", async (params, body) => {
    const readSession = vi.fn().mockResolvedValue(null);
    const response = await deleteRequest(dependencies({ readSession }), { params, body });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(readSession).not.toHaveBeenCalled();
  });

  it("passes authenticated identity, guest token, and confirmation token to the service", async () => {
    const deleteOption = vi.fn<DeleteOptionDependencies["deleteOption"]>(
      () => ({ revision: 7 }),
    );
    const deps = dependencies({
      deleteOption,
      readSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", name: "User" },
      }),
    });

    const response = await deleteRequest(deps, {
      body: JSON.stringify({
        participantId: PARTICIPANT_ID,
        confirmationToken: CONFIRMATION_TOKEN,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 7 });
    expect(deleteOption).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      optionId: OPTION_ID,
      participantId: PARTICIPANT_ID,
      confirmationToken: CONFIRMATION_TOKEN,
      identity: { userId: "user-1" },
      guestSessionToken: "guest-token",
    }, tokenDigester, rateKeyDigester, confirmationDigester);
  });

  it("passes guest-only actor inputs without adding a confirmation token", async () => {
    const deleteOption = vi.fn<DeleteOptionDependencies["deleteOption"]>(
      () => ({ revision: 3 }),
    );
    const deps = dependencies({ deleteOption });

    const response = await deleteRequest(deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 3 });
    expect(deleteOption).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      optionId: OPTION_ID,
      participantId: PARTICIPANT_ID,
      confirmationToken: undefined,
      identity: null,
      guestSessionToken: "guest-token",
    }, tokenDigester, rateKeyDigester, confirmationDigester);
  });

  it.each([
    "DELETE_CONFIRMATION_REQUIRED",
    "STALE_DELETE_CONFIRMATION",
  ] as const)("preserves %s confirmation details", async (code) => {
    const response = await deleteRequest(dependencies({
      deleteOption: vi.fn(() => {
        throw new AppError(code, "Confirm this deletion.", {
          details: confirmationDetails,
        });
      }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code,
        message: "Confirm this deletion.",
        details: confirmationDetails,
      },
    });
  });

  it.each([
    ["VALIDATION_FAILED", 400],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["APPOINTMENT_FINALIZED", 409],
  ] as const)("returns stable %s service failures", async (code, status) => {
    const response = await deleteRequest(dependencies({
      deleteOption: vi.fn(() => {
        throw new AppError(code, "Stable failure.");
      }),
    }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: "Stable failure." },
    });
  });

  it("returns Retry-After for rate limiting", async () => {
    const response = await deleteRequest(dependencies({
      deleteOption: vi.fn(() => {
        throw new AppError("RATE_LIMITED", "Try again later.", {
          retryAfterSeconds: 17,
        });
      }),
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });

  it("propagates unknown errors", async () => {
    const error = new Error("database unavailable");

    await expect(deleteRequest(dependencies({
      deleteOption: vi.fn(() => {
        throw error;
      }),
    }))).rejects.toBe(error);
  });
});
