import { describe, expect, it, vi } from "vitest";

import { AppError } from "../../../../../features/appointments/http-errors";
import type { AppointmentSnapshot } from "../../../../../features/appointments/contracts";
import type { ServiceContext } from "../../../../../features/appointments/server/service-context";
import type { GuestTokenDigester } from "../../../../../lib/security";
import {
  createAppointmentSnapshotGetHandler,
  type AppointmentSnapshotGetDependencies,
} from "./route-handler";

const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const PARTICIPANT_ID = "00000000-0000-4000-8000-000000000001";
const context = {} as ServiceContext;
const tokenDigester = {} as GuestTokenDigester;
const result = {
  appointment: { publicId: PUBLIC_ID, revision: 1 },
  participants: [],
  options: [],
  viewer: { kind: "anonymous" },
} as unknown as AppointmentSnapshot;

function dependencies(
  overrides: Partial<AppointmentSnapshotGetDependencies> = {},
): AppointmentSnapshotGetDependencies {
  return {
    context,
    tokenDigester,
    readSession: vi.fn().mockResolvedValue(null),
    getSnapshot: vi.fn(() => result),
    readGuestSessionToken: vi.fn(() => "guest-token"),
    ...overrides,
  };
}

function get(
  deps: AppointmentSnapshotGetDependencies,
  search = "",
  params: Record<string, string> = { publicId: PUBLIC_ID },
): Promise<Response> {
  return createAppointmentSnapshotGetHandler(deps)(
    new Request(`https://appointments.example/api/appointments/${PUBLIC_ID}/snapshot${search}`),
    { params: Promise.resolve(params) },
  );
}

describe("createAppointmentSnapshotGetHandler", () => {
  it("parses the optional participant, session, and guest cookie", async () => {
    const getSnapshot = vi.fn(() => result);
    const deps = dependencies({ getSnapshot });

    const response = await get(deps, `?participantId=${PARTICIPANT_ID}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
    expect(getSnapshot).toHaveBeenCalledWith(context, {
      publicId: PUBLIC_ID,
      identity: null,
      requestedParticipantId: PARTICIPANT_ID,
      guestSessionToken: "guest-token",
    }, tokenDigester);
  });

  it("maps an authenticated session without requiring authentication", async () => {
    const getSnapshot = vi.fn<AppointmentSnapshotGetDependencies["getSnapshot"]>(
      () => result,
    );
    const deps = dependencies({
      getSnapshot,
      readSession: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", name: "User" },
      }),
    });

    await get(deps);

    expect(getSnapshot.mock.calls[0]?.[1]).toMatchObject({
      identity: { userId: "user-1", email: "user@example.com", name: "User" },
    });
  });

  it.each([
    ["?participantId=bad", "participantId"],
    ["?unknown=value", "unknown"],
    [`?participantId=${PARTICIPANT_ID}&participantId=${PARTICIPANT_ID}`, "participantId"],
  ])("rejects invalid query %s before session work", async (search, field) => {
    const readSession = vi.fn().mockResolvedValue(null);
    const getSnapshot = vi.fn(() => result);

    const response = await get(dependencies({ readSession, getSnapshot }), search);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_FAILED", fieldErrors: { [field]: expect.any(Array) } },
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("returns stable app errors", async () => {
    const response = await get(dependencies({
      getSnapshot: vi.fn(() => {
        throw new AppError("NOT_FOUND", "Appointment was not found.");
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Appointment was not found." },
    });
  });
});
