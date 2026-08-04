import { describe, expect, it } from "vitest";

import {
  APP_ERROR_STATUS,
  AppError,
  appErrorResponse,
  type AppErrorCode,
} from "./http-errors";

const expectedStatuses = {
  INTERNAL_ERROR: 500,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORIGIN_MISMATCH: 403,
  NOT_FOUND: 404,
  APPOINTMENT_FINALIZED: 409,
  OPTION_LIMIT_REACHED: 409,
  PARTICIPANT_LIMIT_REACHED: 409,
  NAME_TAKEN: 409,
  DUPLICATE_OPTION: 409,
  LIMIT_BELOW_CURRENT_COUNT: 409,
  DELETE_CONFIRMATION_REQUIRED: 409,
  STALE_DELETE_CONFIRMATION: 409,
  RATE_LIMITED: 429,
  COORGANIZER_LIMIT_REACHED: 409,
  MANAGER_ALREADY_EXISTS: 409,
  TITLE_CONFIRMATION_MISMATCH: 400,
  INVALID_EDIT_LINK: 403,
  INVALID_FINAL_OPTION: 409,
} as const satisfies Record<AppErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500>;

describe("APP_ERROR_STATUS", () => {
  it("contains every app error code once with its exact HTTP status", () => {
    expect(APP_ERROR_STATUS).toEqual(expectedStatuses);
    expect(Object.keys(APP_ERROR_STATUS)).toHaveLength(20);
  });

  it.each(Object.entries(expectedStatuses))(
    "maps %s to HTTP %i",
    async (code, expectedStatus) => {
      const response = appErrorResponse(new AppError(code as AppErrorCode, "Caller message"));

      expect(response.status).toBe(expectedStatus);
    },
  );
});

describe("appErrorResponse", () => {
  it("serializes the exact error wrapper and preserves the caller's message", async () => {
    const response = appErrorResponse(
      new AppError("NOT_FOUND", "Appointment was not found."),
    );

    expect(await response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Appointment was not found.",
      },
    });
  });

  it("omits fieldErrors and details when callers do not supply them", async () => {
    const response = appErrorResponse(
      new AppError("VALIDATION_FAILED", "Check the submitted fields."),
    );
    const body = await response.json();

    expect(body).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Check the submitted fields.",
      },
    });
    expect(Object.keys(body.error)).toEqual(["code", "message"]);
  });

  it("includes fieldErrors and details when callers supply them", async () => {
    const response = appErrorResponse(
      new AppError("DELETE_CONFIRMATION_REQUIRED", "Confirm this deletion.", {
        fieldErrors: {
          title: ["Enter the exact appointment title."],
        },
        details: {
          count: 2,
          names: ["Ada", "Grace"],
          token: "confirmation-token",
        },
      }),
    );

    expect(await response.json()).toEqual({
      error: {
        code: "DELETE_CONFIRMATION_REQUIRED",
        message: "Confirm this deletion.",
        fieldErrors: {
          title: ["Enter the exact appointment title."],
        },
        details: {
          count: 2,
          names: ["Ada", "Grace"],
          token: "confirmation-token",
        },
      },
    });
  });

  it("keeps empty optional objects when callers explicitly supply them", async () => {
    const response = appErrorResponse(
      new AppError("VALIDATION_FAILED", "Invalid request.", {
        fieldErrors: {},
        details: {},
      }),
    );

    expect(await response.json()).toEqual({
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid request.",
        fieldErrors: {},
        details: {},
      },
    });
  });

  it("adds custom headers without changing the body or mapped status", async () => {
    const response = appErrorResponse(
      new AppError("RATE_LIMITED", "Try again later."),
      { headers: { "Retry-After": "60", "X-Request-Id": "request-1" } },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Try again later.",
      },
    });
  });

  it("always returns the JSON content type even if a caller tries to replace it", () => {
    const response = appErrorResponse(
      new AppError("FORBIDDEN", "Access denied."),
      { headers: { "Content-Type": "text/plain", "Retry-After": "10" } },
    );

    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("retry-after")).toBe("10");
  });

  it("returns a generic 500 without serializing an internal cause or secret data", async () => {
    const cause = new Error("database password: do-not-serialize");
    const error = new AppError("INTERNAL_ERROR", "The appointment could not be created.", {
      cause,
    });
    Object.assign(error, { secret: "raw-token", internalContext: { table: "appointments" } });

    expect(error.cause).toBe(cause);
    const response = appErrorResponse(error);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).toBe(
      '{"error":{"code":"INTERNAL_ERROR","message":"The appointment could not be created."}}',
    );
  });
});
