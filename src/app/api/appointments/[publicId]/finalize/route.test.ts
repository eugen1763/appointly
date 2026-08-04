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
  finalizeAppointment: vi.fn().mockReturnValue({ revision: 7 }),
}));

vi.mock("../../../../../features/appointments/server/management", async (importOriginal) => ({
  ...(await importOriginal()),
  finalizeAppointment: mocks.finalizeAppointment,
}));
vi.mock("../../../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: mocks.context,
}));
vi.mock("../../../../../lib/auth", () => ({ readServerSession: mocks.readServerSession }));
vi.mock("../../../../../lib/env", () => ({ getEnv: mocks.getEnv }));

import { POST, runtime } from "./route";

afterEach(() => vi.clearAllMocks());

describe("appointment finalize production route", () => {
  it("wires Node POST to the shared context, Better Auth session, and canonical origin", async () => {
    const optionId = "00000000-0000-4000-8000-000000000001";
    const response = await POST(
      new Request(
        "https://untrusted.example/api/appointments/abcdefghijklmnopqrstuvwx/finalize",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://canonical.example",
          },
          body: JSON.stringify({ optionId }),
        },
      ),
      { params: Promise.resolve({ publicId: "abcdefghijklmnopqrstuvwx" }) },
    );

    expect(runtime).toBe("nodejs");
    expect(mocks.getEnv).toHaveBeenCalledOnce();
    expect(mocks.readServerSession).toHaveBeenCalledOnce();
    expect(mocks.finalizeAppointment).toHaveBeenCalledWith(mocks.context, {
      publicId: "abcdefghijklmnopqrstuvwx",
      userId: "production-manager-id",
      optionId,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 7 });
  });
});
