"use client";

import { useRef, useState, type ChangeEvent } from "react";

import { putResponseSuccessSchema } from "../../../features/appointments/contracts";
import type { PublicOption } from "../../../features/appointments/server/snapshot";
import routeStyles from "../../routes.module.css";
import styles from "./appointment.module.css";
import { OptionLabel } from "./PublicAppointmentView";

export type ResponseValue = "YES" | "NO" | null;

interface PendingResponse {
  readonly value: ResponseValue;
}

interface FailedResponse {
  readonly value: ResponseValue;
  readonly message: string;
}

const GENERIC_RESPONSE_ERROR =
  "Your answer was not saved. Check your connection, then use Retry.";
const INVALID_RESPONSE =
  "Your answer may not have been saved — the reply could not be read. Reload the page to check.";

export function responseErrorMessage(body: unknown): string {
  if (
    typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "object"
    && body.error !== null
    && "message" in body.error
    && typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return GENERIC_RESPONSE_ERROR;
}

const CHOICES = [
  ["YES", "Yes", styles.markYes],
  ["NO", "No", styles.markNo],
  ["UNANSWERED", "Unanswered", styles.markNone],
] as const;

export interface ResponseControlProps {
  readonly publicId: string;
  readonly option: PublicOption;
  readonly participantId: string;
  readonly savedValue: ResponseValue;
  readonly onSaved: (
    optionId: string,
    value: ResponseValue,
    revision: number,
    participantId: string,
  ) => void;
}

/** One option's answer. State is per instance so a save never disables a sibling. */
export function ResponseControl({
  publicId,
  option,
  participantId,
  savedValue,
  onSaved,
}: ResponseControlProps) {
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const [failure, setFailure] = useState<FailedResponse | null>(null);
  const [status, setStatus] = useState<"Saving" | "Saved" | null>(null);
  const inFlight = useRef(false);

  const optionId = option.id;
  const value = pending === null ? savedValue : pending.value;
  const saving = pending !== null;
  const statusId = `response-save-status-${optionId}`;
  const errorId = `response-save-error-${optionId}`;

  async function save(nextValue: ResponseValue): Promise<void> {
    if (inFlight.current) return;
    const currentValue = pending === null ? savedValue : pending.value;
    if (currentValue === nextValue) return;

    inFlight.current = true;
    setPending({ value: nextValue });
    setFailure(null);
    setStatus("Saving");

    try {
      const response = await fetch(
        `/api/appointments/${publicId}/responses/${optionId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId, value: nextValue }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseErrorMessage(body));
      const parsed = putResponseSuccessSchema.safeParse(body);
      if (!parsed.success || parsed.data.value !== nextValue) {
        throw new Error(INVALID_RESPONSE);
      }
      onSaved(optionId, nextValue, parsed.data.revision, participantId);
      setPending(null);
      setStatus("Saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : GENERIC_RESPONSE_ERROR;
      setPending(null);
      setStatus(null);
      setFailure({ value: nextValue, message });
    } finally {
      inFlight.current = false;
    }
  }

  function selectResponse(event: ChangeEvent<HTMLInputElement>): void {
    if (!event.currentTarget.checked) return;
    const nextValue = event.currentTarget.value === "UNANSWERED"
      ? null
      : event.currentTarget.value as "YES" | "NO";
    void save(nextValue);
  }

  return (
    <fieldset
      className={styles.responseGroup}
      aria-describedby={failure ? errorId : status ? statusId : undefined}
      disabled={saving}
    >
      <legend className={routeStyles.visuallyHidden}><OptionLabel option={option} /></legend>
      <div className={styles.seg}>
        {CHOICES.map(([controlValue, label, markClassName]) => {
          const id = `response-${optionId}-${controlValue.toLowerCase()}`;
          return (
            <label className={styles.segOpt} htmlFor={id} key={controlValue}>
              <input
                checked={value === (controlValue === "UNANSWERED" ? null : controlValue)}
                id={id}
                name={`response-${optionId}`}
                type="radio"
                value={controlValue}
                onChange={selectResponse}
              />
              <span className={styles.segFace} aria-hidden="true">
                <span className={`${styles.mark} ${markClassName}`} />
              </span>
              <span className={routeStyles.visuallyHidden}>{label}</span>
            </label>
          );
        })}
      </div>
      <span
        className={styles.saveStatus}
        id={statusId}
        data-save-status={optionId}
        aria-live="polite"
      >
        {status ?? ""}
      </span>
      {failure ? (
        <div className={styles.responseError} id={errorId} role="alert">
          <span>{failure.message}</span>
          <button type="button" onClick={() => void save(failure.value)}>Retry</button>
        </div>
      ) : null}
    </fieldset>
  );
}
