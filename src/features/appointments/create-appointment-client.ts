import {
  appointmentRouteContracts,
  createAppointmentSuccessSchema,
  type CreateAppointmentInput,
  type CreateAppointmentSuccess,
  type RouteErrorCode,
} from "./contracts";

export type CreateAppointmentSubmit = (
  input: CreateAppointmentInput,
) => Promise<CreateAppointmentSuccess>;

export class CreateAppointmentRequestError extends Error {
  readonly code: RouteErrorCode<"createAppointment"> | "UNEXPECTED_RESPONSE";
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    code: RouteErrorCode<"createAppointment"> | "UNEXPECTED_RESPONSE",
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "CreateAppointmentRequestError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const unexpectedResponse = () => new CreateAppointmentRequestError(
  "UNEXPECTED_RESPONSE",
  "Appointment creation returned an unexpected response.",
);

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw unexpectedResponse();
  }
}

export async function submitCreateAppointment(
  input: CreateAppointmentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateAppointmentSuccess> {
  const response = await fetchImpl("/api/appointments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson(response);

  if (response.status === 201) {
    const result = createAppointmentSuccessSchema.safeParse(body);
    if (result.success) return result.data;
    throw unexpectedResponse();
  }

  const result = appointmentRouteContracts.createAppointment.errors.bodySchema.safeParse(body);
  if (!result.success) throw unexpectedResponse();

  throw new CreateAppointmentRequestError(
    result.data.error.code,
    result.data.error.message,
    result.data.error.fieldErrors,
  );
}
