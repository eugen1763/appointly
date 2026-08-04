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
  updateAppointment: vi.fn().mockReturnValue({ revision: 7 }),
  deleteAppointment: vi.fn(),
}));

vi.mock("../../../../features/appointments/server/management", async (importOriginal) => ({
  ...(await importOriginal()),
  deleteAppointment: mocks.deleteAppointment,
  updateAppointment: mocks.updateAppointment,
}));
vi.mock("../../../../features/appointments/server/production-service-context", () => ({
  productionServiceContext: mocks.context,
}));
vi.mock("../../../../lib/auth", () => ({ readServerSession: mocks.readServerSession }));
vi.mock("../../../../lib/env", () => ({ getEnv: mocks.getEnv }));

import { DELETE, PATCH, runtime } from "./route";

afterEach(() => vi.clearAllMocks());

describe("appointment production route", () => {
  it("wires Node PATCH to the shared context, Better Auth session, and canonical origin", async () => {
    const body = { title: "Production update", description: null, optionLimit: 8 };
    const response = await PATCH(
      new Request("https://untrusted.example/api/appointments/abcdefghijklmnopqrstuvwx", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://canonical.example",
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ publicId: "abcdefghijklmnopqrstuvwx" }) },
    );

    expect(runtime).toBe("nodejs");
    expect(mocks.getEnv).toHaveBeenCalledOnce();
    expect(mocks.readServerSession).toHaveBeenCalledOnce();
    expect(mocks.updateAppointment).toHaveBeenCalledWith(mocks.context, {
      publicId: "abcdefghijklmnopqrstuvwx",
      userId: "production-manager-id",
      changes: body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revision: 7 });
  });

  it("wires DELETE to the owner service and preserves the empty 204 response", async () => {
    const response = await DELETE(
      new Request("https://untrusted.example/api/appointments/abcdefghijklmnopqrstuvwx", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://canonical.example",
        },
        body: JSON.stringify({ title: "Planning" }),
      }),
      { params: Promise.resolve({ publicId: "abcdefghijklmnopqrstuvwx" }) },
    );

    expect(mocks.readServerSession).toHaveBeenCalledOnce();
    expect(mocks.deleteAppointment).toHaveBeenCalledWith(mocks.context, {
      publicId: "abcdefghijklmnopqrstuvwx",
      userId: "production-manager-id",
      title: "Planning",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });
});
