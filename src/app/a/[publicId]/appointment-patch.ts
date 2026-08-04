import {
  appointmentRouteContracts,
  revisionSuccessSchema,
  type UpdateAppointmentRequest,
} from "../../../features/appointments/contracts";

const GENERIC_PATCH_ERROR = "Could not save the change. Try again.";
const INVALID_PATCH_RESPONSE = "The server returned an invalid save response. Try again.";

/**
 * Reads whatever the route actually sent back: a field error first, because it
 * names the offending value, then the envelope message, then the caller's
 * fallback for a body that carries neither.
 *
 * Lives here rather than in `InlineOptionAdd` so the suggestion form and the
 * detail edits report route failures through one implementation; the fallback is
 * a parameter because each mutation says what it could not do.
 */
export function routeErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body !== "object"
    || body === null
    || !("error" in body)
    || typeof body.error !== "object"
    || body.error === null
  ) {
    return fallback;
  }
  if ("fieldErrors" in body.error && typeof body.error.fieldErrors === "object") {
    for (const messages of Object.values(body.error.fieldErrors ?? {})) {
      if (
        Array.isArray(messages)
        && typeof messages[0] === "string"
      ) {
        return messages[0];
      }
    }
  }
  return "message" in body.error && typeof body.error.message === "string"
    ? body.error.message
    : fallback;
}

export type PatchAppointmentResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly message: string };

/**
 * One PATCH path for the title, the description and the option limit, so all
 * three fold their new revision into the snapshot the same way.
 *
 * The error body is parsed against the route contract, so a reply the route does
 * not promise — an unlisted code, a truncated envelope — reads as the generic
 * failure rather than as text of unknown provenance.
 */
export async function patchAppointmentDetails(
  publicId: string,
  body: UpdateAppointmentRequest,
): Promise<PatchAppointmentResult> {
  let response: Response;
  try {
    response = await fetch(`/api/appointments/${publicId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: GENERIC_PATCH_ERROR };
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    return {
      ok: false,
      message: response.ok ? INVALID_PATCH_RESPONSE : GENERIC_PATCH_ERROR,
    };
  }

  if (!response.ok) {
    const parsed = appointmentRouteContracts.updateAppointment.errors.bodySchema
      .safeParse(parsedBody);
    return {
      ok: false,
      message: parsed.success
        ? routeErrorMessage(parsed.data, GENERIC_PATCH_ERROR)
        : GENERIC_PATCH_ERROR,
    };
  }
  const parsed = revisionSuccessSchema.safeParse(parsedBody);
  return parsed.success
    ? { ok: true, revision: parsed.data.revision }
    : { ok: false, message: INVALID_PATCH_RESPONSE };
}
