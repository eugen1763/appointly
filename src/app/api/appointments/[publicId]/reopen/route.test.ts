import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: { marker: "production-context" },
  getEnv: vi.fn().mockReturnValue({ appOrigin: "https://canonical.example" }),
  readServerSession: vi.fn().mockResolvedValue({
    user: {
      id: "production-manager-id",
      email: "manager@example.com",
      name: "Production Manager",
    },
  }),
  reopenAppointment: vi.fn().mockReturnValue({ revision: 9 }),
}));

vi.mock("../../../../../features/appointments/server/management", async (importOriginal) => ({
  ...(await importOriginal()),
  reopenAppointment: mocks.reopenAppointment,
}));
vi.mock("../../../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: mocks.context,
}));
vi.mock("../../../../../lib/auth", () => ({ readServerSession: mocks.readServerSession }));
vi.mock("../../../../../lib/env", () => ({ getEnv: mocks.getEnv }));

import { POST, runtime } from "./route";

afterEach(() => vi.clearAllMocks());

describe("appointment reopen production route", () => {
  it("wires Node POST to the shared context, Better Auth session, and canonical origin", async () => {
    const response = await POST(
      new Request("https://untrusted.example/api/appointments/abcdefghijklmnopqrstuvwx/reopen", {
        method: "POST",
        headers: { origin: "https://canonical.example" },
      }),
      { params: Promise.resolve({ publicId: "abcdefghijklmnopqrstuvwx" }) },
    );

    expect(runtime).toBe("nodejs");
    expect(mocks.getEnv).toHaveBeenCalledOnce();
    expect(mocks.readServerSession).toHaveBeenCalledOnce();
    expect(mocks.reopenAppointment).toHaveBeenCalledWith(mocks.context, {
      publicId: "abcdefghijklmnopqrstuvwx",
      userId: "production-manager-id",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 9 });
  });
});
