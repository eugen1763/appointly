import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../../../features/appointments/http-errors";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import type {
  GuestTokenDigester,
  RateKeyDigester,
} from "../../../../../lib/security";
import {
  createAddOptionPostHandler,
  type AddOptionPostDependencies,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000002";
const OPTION_ID = "00000000-0000-4000-8000-000000000001";
const context = {} as ServiceContext;
const tokenDigester = {} as GuestTokenDigester;
const rateKeyDigester = {} as RateKeyDigester;
const requestBody = {
  participantId: PARTICIPANT_ID,
  timeZone: "America/Toronto",
  option: { kind: "DATE" as const, startDate: "2030-04-03" },
};

function dependencies(
  overrides: Partial<AddOptionPostDependencies> = {},
): AddOptionPostDependencies {
  return {
    appOrigin: APP_ORIGIN,
    context,
    tokenDigester,
    rateKeyDigester,
    readSession: vi.fn().mockResolvedValue(null),
    readGuestSessionToken: vi.fn(() => "guest-token"),
    addOption: vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 2 }),
    ),
    ...overrides,
  };
}

function post(
  deps: AddOptionPostDependencies,
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

  return createAddOptionPostHandler(deps)(new Request(
    `${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/options`,
    {
      method: "POST",
      headers,
      body: options.body ?? JSON.stringify(requestBody),
    },
  ), {
    params: Promise.resolve(options.params ?? { publicId: PUBLIC_ID }),
  });
}

describe("createAddOptionPostHandler", () => {
  it.each([
    [undefined, "ORIGIN_MISMATCH"],
    ["https://evil.example", "ORIGIN_MISMATCH"],
  ])("requires the exact Origin before reading request inputs", async (origin, code) => {
    const readSession = vi.fn().mockResolvedValue(null);
    const addOption = vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 2 }),
    );
    const response = await post(dependencies({ readSession, addOption }), {
      origin: origin ?? "missing",
      params: { publicId: "bad", extra: "field" },
      body: "not-json",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code,
        message: "The request origin does not match this application.",
      },
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(addOption).not.toHaveBeenCalled();
  });

  it("strictly parses route params before reading the session", async () => {
    const readSession = vi.fn().mockResolvedValue(null);
    const addOption = vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 2 }),
    );
    const response = await post(dependencies({ readSession, addOption }), {
      params: { publicId: PUBLIC_ID, extra: "field" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(addOption).not.toHaveBeenCalled();
  });

  it.each([
    [JSON.stringify({ ...requestBody, extra: true })],
    [JSON.stringify({ ...requestBody, participantId: "not-a-uuid" })],
    ["not-json"],
  ])("strictly parses the JSON body before reading the session", async (body) => {
    const readSession = vi.fn().mockResolvedValue(null);
    const addOption = vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 2 }),
    );
    const response = await post(dependencies({ readSession, addOption }), { body });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(addOption).not.toHaveBeenCalled();
  });

  it("passes authenticated actor inputs and returns the created option", async () => {
    const addOption = vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 7 }),
    );
    const deps = dependencies({
      addOption,
      readSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", name: "User" },
      }),
    });

    const response = await post(deps);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ optionId: OPTION_ID, revision: 7 });
    expect(addOption).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      participantId: PARTICIPANT_ID,
      timeZone: "America/Toronto",
      option: { kind: "DATE", startDate: "2030-04-03" },
      identity: { userId: "user-1" },
      guestSessionToken: "guest-token",
    }, tokenDigester, rateKeyDigester);
  });

  it("passes guest actor inputs without an authenticated identity", async () => {
    const addOption = vi.fn<AddOptionPostDependencies["addOption"]>(
      () => ({ optionId: OPTION_ID, revision: 3 }),
    );

    const response = await post(dependencies({ addOption }));

    expect(response.status).toBe(201);
    expect(addOption).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      participantId: PARTICIPANT_ID,
      timeZone: "America/Toronto",
      option: { kind: "DATE", startDate: "2030-04-03" },
      identity: null,
      guestSessionToken: "guest-token",
    }, tokenDigester, rateKeyDigester);
  });

  it("maps stable AppError values to stable responses", async () => {
    const response = await post(dependencies({
      addOption: vi.fn(() => {
        throw new AppError("DUPLICATE_OPTION", "That option already exists.");
      }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "DUPLICATE_OPTION",
        message: "That option already exists.",
      },
    });
  });

  it("propagates unknown errors instead of treating them as AppError values", async () => {
    const fault = new Error("private database detail");
    const request = post(dependencies({
      addOption: vi.fn(() => {
        throw fault;
      }),
    }));

    await expect(request).rejects.toBe(fault);
  });
});
