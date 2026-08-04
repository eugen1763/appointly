import { describe, expect, it, vi } from "vitest";

import type { CreateAppointmentInput } from "./contracts";
import {
  CreateAppointmentRequestError,
  submitCreateAppointment,
} from "./create-appointment-client";

const input: CreateAppointmentInput = {
  title: "Planning review",
  description: null,
  ownerDisplayName: "Ada Lovelace",
  type: "DATE",
  optionLimit: 4,
  coOrganizerEmails: ["grace@example.com"],
  timeZone: "Europe/London",
  options: [{ kind: "DATE", startDate: "2030-04-03" }],
};

const success = {
  publicId: "abcdefghijklmnopqrstuvwx",
  publicUrl: "https://appointly.test/a/abcdefghijklmnopqrstuvwx",
  revision: 1 as const,
};

describe("submitCreateAppointment", () => {
  it("posts the exact input as JSON to the relative appointment route and accepts a valid 201", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(success), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(submitCreateAppointment(input, fetchImpl)).resolves.toEqual(success);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  });

  it("rejects a valid-looking success body when the status is not 201", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(success), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(submitCreateAppointment(input, fetchImpl)).rejects.toMatchObject({
      name: "CreateAppointmentRequestError",
      message: "Appointment creation returned an unexpected response.",
    });
  });

  it("preserves a valid API error code, message, and field errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Check the submitted fields.",
          fieldErrors: { title: ["Enter a title."] },
        },
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const error = await submitCreateAppointment(input, fetchImpl).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CreateAppointmentRequestError);
    expect(error).toMatchObject({
      code: "VALIDATION_FAILED",
      message: "Check the submitted fields.",
      fieldErrors: { title: ["Enter a title."] },
    });
  });

  it("turns a malformed API error into an actionable request error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "No code" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(submitCreateAppointment(input, fetchImpl)).rejects.toMatchObject({
      name: "CreateAppointmentRequestError",
      message: "Appointment creation returned an unexpected response.",
    });
  });

  it("rejects a malformed 201 body instead of inventing share data", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ publicUrl: "/a/local-only" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(submitCreateAppointment(input, fetchImpl)).rejects.toMatchObject({
      name: "CreateAppointmentRequestError",
      message: "Appointment creation returned an unexpected response.",
    });
  });
});
