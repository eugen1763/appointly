import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../../../../../features/appointments/http-errors";
import type { ServiceContext } from "../../../../../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../../../../../lib/auth-session";
import type { GuestTokenDigester } from "../../../../../../../lib/security";
import {
  createResetParticipantLinkPostHandler,
  type ResetParticipantLinkCommand,
  type ResetParticipantLinkSessionReader,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example";
const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000123";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const EDIT_URL = `/a/${PUBLIC_ID}/edit#participant=${PARTICIPANT_ID}&token=${Buffer.alloc(32, 0x71).toString("base64url")}`;
const SESSION: ManagerSession = {
  user: { id: USER_ID, email: "owner@example.com", name: "Owner" },
};
const context = {} as ServiceContext;
const tokenDigester = {} as GuestTokenDigester;

function request(body?: string, origin = APP_ORIGIN): Request {
  return new Request(`${APP_ORIGIN}/api/appointments/${PUBLIC_ID}/participants/${PARTICIPANT_ID}/reset-link`, {
    method: "POST",
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
  });
}

function dependencies(overrides: {
  readSession?: ResetParticipantLinkSessionReader;
  resetParticipantLink?: ResetParticipantLinkCommand;
} = {}) {
  return {
    appOrigin: APP_ORIGIN,
    context,
    tokenDigester,
    readSession: overrides.readSession ?? vi.fn().mockResolvedValue(SESSION),
    resetParticipantLink: overrides.resetParticipantLink ?? vi.fn().mockReturnValue({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
      revision: 4,
    }),
  };
}

function post(
  deps = dependencies(),
  params: Record<string, string> = { publicId: PUBLIC_ID, participantId: PARTICIPANT_ID },
  body?: string,
  origin = APP_ORIGIN,
): Promise<Response> {
  return createResetParticipantLinkPostHandler(deps)(request(body, origin), {
    params: Promise.resolve(params),
  });
}

async function expectError(responsePromise: Promise<Response>, status: number, code: string) {
  const response = await responsePromise;
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(code === "VALIDATION_FAILED" ? { fieldErrors: expect.any(Object) } : {}),
    },
  });
}

describe("reset participant link POST handler", () => {
  it("returns only the exact reset result and passes the manager identity", async () => {
    const resetParticipantLink = vi.fn<ResetParticipantLinkCommand>().mockReturnValue({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
      revision: 4,
    });
    const response = await post(dependencies({ resetParticipantLink }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      participantId: PARTICIPANT_ID,
      editUrl: EDIT_URL,
      revision: 4,
    });
    expect(resetParticipantLink).toHaveBeenCalledOnce();
    expect(resetParticipantLink).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      participantId: PARTICIPANT_ID,
      managerUserId: USER_ID,
    }, tokenDigester);
  });

  it("requires the exact Origin before params, body, or session work", async () => {
    const readSession = vi.fn<ResetParticipantLinkSessionReader>().mockResolvedValue(SESSION);
    const resetParticipantLink = vi.fn<ResetParticipantLinkCommand>();

    await expectError(
      post(dependencies({ readSession, resetParticipantLink }), undefined, undefined, "https://evil.example"),
      403,
      "ORIGIN_MISMATCH",
    );
    expect(readSession).not.toHaveBeenCalled();
    expect(resetParticipantLink).not.toHaveBeenCalled();
  });

  it("accepts a zero-byte transport body as no request body", async () => {
    const response = await post(dependencies(), undefined, "");
    expect(response.status).toBe(200);
  });

  it.each([
    ["bad public ID", { publicId: "short", participantId: PARTICIPANT_ID }, undefined],
    ["bad participant ID", { publicId: PUBLIC_ID, participantId: "bad" }, undefined],
    ["extra param", { publicId: PUBLIC_ID, participantId: PARTICIPANT_ID, extra: "no" }, undefined],
    ["request body", { publicId: PUBLIC_ID, participantId: PARTICIPANT_ID }, "{}"],
  ])("rejects a %s before reading the session", async (_case, params, body) => {
    const readSession = vi.fn<ResetParticipantLinkSessionReader>().mockResolvedValue(SESSION);
    await expectError(post(dependencies({ readSession }), params, body), 400, "VALIDATION_FAILED");
    expect(readSession).not.toHaveBeenCalled();
  });

  it("requires a valid Better Auth session", async () => {
    await expectError(post(dependencies({
      readSession: vi.fn().mockResolvedValue(null),
    })), 401, "UNAUTHENTICATED");
  });

  it.each([
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["APPOINTMENT_FINALIZED", 409],
  ])("returns the stable %s service error", async (code, status) => {
    const resetParticipantLink = vi.fn<ResetParticipantLinkCommand>().mockImplementation(() => {
      throw new AppError(code as "FORBIDDEN", "Fixed safe message.");
    });
    await expectError(post(dependencies({ resetParticipantLink })), status, code);
  });

  it("maps unexpected command failures to a fixed non-leaking 500", async () => {
    const resetParticipantLink = vi.fn<ResetParticipantLinkCommand>().mockImplementation(() => {
      throw new Error("database secret");
    });
    const response = await post(dependencies({ resetParticipantLink }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Could not reset the private edit link.",
      },
    });
  });
});
