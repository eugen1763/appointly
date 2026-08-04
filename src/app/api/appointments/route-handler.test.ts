import { describe, expect, it, vi } from "vitest";

import type { CreateAppointmentInput } from "../../../features/appointments/contracts";
import { AppError } from "../../../features/appointments/http-errors";
import type {
  CreateAppointmentCommandInput,
  CreateAppointmentResult,
} from "../../../features/appointments/server/create-appointment";
import type { ServiceContext } from "../../../features/appointments/server/service-context";
import type { ManagerSession } from "../../../lib/auth-session";
import {
  createAppointmentsPostHandler,
  type AppointmentsSessionReader,
  type CreateAppointmentCommand,
} from "./route-handler";

const APP_ORIGIN = "https://appointments.example:8443";
const PUBLIC_ID = "abcdefghijklmnopqrstuvwx";
const session: ManagerSession = {
  user: {
    id: "owner-user-id",
    email: "Owner@Example.COM",
    name: "Owner Account",
  },
};
const context = {} as ServiceContext;

function validBody(
  overrides: Partial<CreateAppointmentInput> = {},
): CreateAppointmentInput {
  return {
    title: "Project planning",
    description: null,
    ownerDisplayName: "Owner Name",
    type: "DATE",
    optionLimit: 2,
    coOrganizerEmails: ["helper@example.com"],
    timeZone: "UTC",
    options: [{ kind: "DATE", startDate: "2030-01-02" }],
    ...overrides,
  };
}

function request(body: BodyInit, origin = APP_ORIGIN): Request {
  return new Request("https://attacker-controlled.example/api/appointments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body,
  });
}

function dependencies(options: {
  readSession?: AppointmentsSessionReader;
  createAppointment?: CreateAppointmentCommand;
} = {}) {
  return {
    appOrigin: APP_ORIGIN,
    context,
    readSession: options.readSession ?? vi.fn().mockResolvedValue(session),
    createAppointment: options.createAppointment ?? vi.fn().mockReturnValue({
      publicId: PUBLIC_ID,
      revision: 1,
    } satisfies CreateAppointmentResult),
  };
}

async function errorBody(response: Response) {
  return response.json() as Promise<{
    error: {
      code: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
  }>;
}

describe("appointments POST handler", () => {
  it("rejects a wrong or missing Origin before reading auth or calling the command", async () => {
    const readSession = vi.fn<AppointmentsSessionReader>().mockResolvedValue(session);
    const createAppointment = vi.fn<CreateAppointmentCommand>();
    const handler = createAppointmentsPostHandler({
      ...dependencies(),
      readSession,
      createAppointment,
    });

    for (const origin of ["https://evil.example", ""]) {
      const response = await handler(request(JSON.stringify(validBody()), origin));
      expect(response.status).toBe(403);
      expect(await errorBody(response)).toEqual({
        error: {
          code: "ORIGIN_MISMATCH",
          message: "The request origin does not match this application.",
        },
      });
    }
    expect(readSession).not.toHaveBeenCalled();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("wraps malformed JSON without reading auth or calling the command", async () => {
    const readSession = vi.fn<AppointmentsSessionReader>().mockResolvedValue(session);
    const createAppointment = vi.fn<CreateAppointmentCommand>();
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      readSession,
      createAppointment,
    })(request("{"));

    expect(response.status).toBe(400);
    expect(await errorBody(response)).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Request body must be valid JSON.",
        fieldErrors: { body: ["Request body must be valid JSON."] },
      },
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("strictly validates the existing creation body before reading auth", async () => {
    const readSession = vi.fn<AppointmentsSessionReader>().mockResolvedValue(session);
    const createAppointment = vi.fn<CreateAppointmentCommand>();
    const body = { ...validBody(), unexpected: true };
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      readSession,
      createAppointment,
    })(request(JSON.stringify(body)));

    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toEqual({
      code: "VALIDATION_FAILED",
      message: "Check the submitted fields.",
      fieldErrors: expect.any(Object),
    });
    expect(readSession).not.toHaveBeenCalled();
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("returns the stable unauthenticated error and never calls the command", async () => {
    const createAppointment = vi.fn<CreateAppointmentCommand>();
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      readSession: vi.fn().mockResolvedValue(null),
      createAppointment,
    })(request(JSON.stringify(validBody())));

    expect(response.status).toBe(401);
    expect(await errorBody(response)).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in with Google to continue.",
      },
    });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("passes the parsed body and exact Better Auth user identity to the injected command", async () => {
    const createAppointment = vi.fn<CreateAppointmentCommand>().mockReturnValue({
      publicId: PUBLIC_ID,
      revision: 1,
    });
    const body = validBody();
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      createAppointment,
    })(request(JSON.stringify(body)));

    expect(response.status).toBe(201);
    expect(createAppointment).toHaveBeenCalledOnce();
    expect(createAppointment).toHaveBeenCalledWith(context, {
      ownerUserId: "owner-user-id",
      ownerEmail: "Owner@Example.COM",
      appointment: body,
    } satisfies CreateAppointmentCommandInput);
  });

  it("wraps a stable service failure without leaking its cause", async () => {
    const databaseCause = new Error("SQLITE_CONSTRAINT secret table detail");
    const createAppointment = vi.fn<CreateAppointmentCommand>().mockImplementation(() => {
      throw new AppError(
        "DUPLICATE_OPTION",
        "Each option must be unique within the appointment.",
        { cause: databaseCause },
      );
    });
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      createAppointment,
    })(request(JSON.stringify(validBody())));

    expect(response.status).toBe(409);
    const body = await errorBody(response);
    expect(body).toEqual({
      error: {
        code: "DUPLICATE_OPTION",
        message: "Each option must be unique within the appointment.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("SQLITE");
  });

  it("returns a generic 500 for an internal service fault without leaking its cause", async () => {
    const databaseCause = new Error("SQLITE_CONSTRAINT secret table detail");
    const createAppointment = vi.fn<CreateAppointmentCommand>().mockImplementation(() => {
      throw new AppError(
        "INTERNAL_ERROR",
        "The appointment could not be created.",
        { cause: databaseCause },
      );
    });
    const response = await createAppointmentsPostHandler({
      ...dependencies(),
      createAppointment,
    })(request(JSON.stringify(validBody())));

    expect(response.status).toBe(500);
    const body = await errorBody(response);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The appointment could not be created.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("SQLITE");
  });

  it("returns only the exact 201 body with a canonical appOrigin public URL", async () => {
    const response = await createAppointmentsPostHandler(dependencies())(
      request(JSON.stringify(validBody())),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      publicId: PUBLIC_ID,
      publicUrl: `${APP_ORIGIN}/a/${PUBLIC_ID}`,
      revision: 1,
    });
  });
});
