export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500;

export const APP_ERROR_STATUS = Object.freeze({
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
} as const satisfies Record<string, AppErrorStatus>);

export type AppErrorCode = keyof typeof APP_ERROR_STATUS;
export type AppFieldErrors = Record<string, string[]>;
export type AppErrorDetails = Record<string, unknown>;

export interface AppErrorOptions extends ErrorOptions {
  fieldErrors?: AppFieldErrors;
  details?: AppErrorDetails;
  retryAfterSeconds?: number;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fieldErrors?: AppFieldErrors;
  readonly details?: AppErrorDetails;
  readonly retryAfterSeconds?: number;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface AppErrorBody {
  error: {
    code: AppErrorCode;
    message: string;
    fieldErrors?: AppFieldErrors;
    details?: AppErrorDetails;
  };
}

export interface AppErrorResponseInit {
  headers?: HeadersInit;
}

export function appErrorResponse(
  error: AppError,
  init: AppErrorResponseInit = {},
): Response {
  const errorBody: AppErrorBody["error"] = {
    code: error.code,
    message: error.message,
  };

  if (error.fieldErrors !== undefined) {
    errorBody.fieldErrors = error.fieldErrors;
  }
  if (error.details !== undefined) {
    errorBody.details = error.details;
  }

  const headers = new Headers(init.headers);
  if (
    error.code === "RATE_LIMITED"
    && Number.isSafeInteger(error.retryAfterSeconds)
    && (error.retryAfterSeconds ?? 0) >= 1
  ) {
    headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify({ error: errorBody } satisfies AppErrorBody), {
    status: APP_ERROR_STATUS[error.code],
    headers,
  });
}
