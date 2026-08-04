import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: { marker: "production-context" },
  createAppointment: vi.fn().mockReturnValue({
    publicId: "abcdefghijklmnopqrstuvwx",
    revision: 1,
  }),
  readServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "production-owner-id",
      email: "production-owner@example.com",
      name: "Production Owner",
    },
  }),
  getEnv: vi.fn().mockReturnValue({
    appOrigin: "https://canonical.example",
  }),
}));

vi.mock("../../../features/appointments/server/create-appointment", async (importOriginal) => ({
  ...(await importOriginal()),
  createAppointment: mocks.createAppointment,
}));
vi.mock("../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: mocks.context,
}));
vi.mock("../../../lib/auth", () => ({
  readServerSession: mocks.readServerSession,
}));
vi.mock("../../../lib/env", () => ({ getEnv: mocks.getEnv }));

import { POST, runtime } from "./route";

afterEach(() => vi.clearAllMocks());

describe("appointments production route", () => {
  it("wires Node POST to the shared context, Better Auth session reader, and canonical origin", async () => {
    const body = {
      title: "Production wiring",
      description: null,
      ownerDisplayName: "Owner",
      type: "DATE",
      optionLimit: 1,
      coOrganizerEmails: [],
      timeZone: "UTC",
      options: [{ kind: "DATE", startDate: "2030-01-02" }],
    };
    const response = await POST(new Request("https://untrusted.example/api/appointments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://canonical.example",
      },
      body: JSON.stringify(body),
    }));

    expect(runtime).toBe("nodejs");
    expect(mocks.getEnv).toHaveBeenCalledOnce();
    expect(mocks.readServerSession).toHaveBeenCalledOnce();
    expect(mocks.createAppointment).toHaveBeenCalledWith(mocks.context, {
      ownerUserId: "production-owner-id",
      ownerEmail: "production-owner@example.com",
      appointment: body,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      publicId: "abcdefghijklmnopqrstuvwx",
      publicUrl: "https://canonical.example/a/abcdefghijklmnopqrstuvwx",
      revision: 1,
    });
  });
});
