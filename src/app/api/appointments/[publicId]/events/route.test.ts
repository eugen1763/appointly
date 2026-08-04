import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: { marker: "production-context" },
  findAppointmentEventTarget: vi.fn(() => ({
    appointmentId: "appointment-internal-id",
    revision: 6,
  })),
  subscribe: vi.fn(() => vi.fn()),
  readGuestSessionCookie: vi.fn(() => {
    throw new Error("events route must not read a guest token");
  }),
  readServerSession: vi.fn(() => {
    throw new Error("events route must not read authentication");
  }),
}));

vi.mock("../../../../../features/appointments/server/event-stream", () => ({
  findAppointmentEventTarget: mocks.findAppointmentEventTarget,
}));
vi.mock("../../../../../features/appointments/server/event-publisher", () => ({
  appointmentEventPublisher: { subscribe: mocks.subscribe },
}));
vi.mock("../../../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: mocks.context,
}));
vi.mock("../../../../../features/appointments/server/guest-session-storage", () => ({
  readGuestSessionCookie: mocks.readGuestSessionCookie,
}));
vi.mock("../../../../../lib/auth", () => ({
  readServerSession: mocks.readServerSession,
}));

import { dynamic, fetchCache, GET, revalidate, runtime } from "./route";

afterEach(() => vi.clearAllMocks());

describe("appointment events production route", () => {
  it("wires the public Node no-store stream to the production context and singleton publisher", async () => {
    const response = await GET(
      new Request("https://appointments.example/api/appointments/abcdefghijklmnopqrstuvwx/events"),
      { params: Promise.resolve({ publicId: "abcdefghijklmnopqrstuvwx" }) },
    );

    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(fetchCache).toBe("force-no-store");
    expect(revalidate).toBe(0);
    expect(mocks.findAppointmentEventTarget).toHaveBeenCalledWith(
      mocks.context,
      "abcdefghijklmnopqrstuvwx",
    );
    expect(mocks.subscribe).toHaveBeenCalledWith(
      "appointment-internal-id",
      expect.any(Function),
    );
    expect(mocks.readServerSession).not.toHaveBeenCalled();
    expect(mocks.readGuestSessionCookie).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await response.body!.cancel();
  });
});
