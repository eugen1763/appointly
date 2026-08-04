"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  appointmentRouteContracts,
  managerParticipantSuccessSchema,
  type AppointmentSnapshot,
} from "../../../features/appointments/contracts";
import { DISPLAY_NAME_MAX_LENGTH } from "../../../features/appointments/validation";
import { routeErrorMessage } from "./appointment-patch";
import styles from "./appointment.module.css";

const GENERIC_ENROLLMENT_ERROR = "Could not join the appointment. Try again.";

type EnrollmentError = AppointmentSnapshot["viewer"]["participantEnrollmentError"];

export interface ManagerEnrollmentFormProps {
  readonly publicId: string;
  readonly enrollmentError: EnrollmentError;
  readonly onEnrolled: (participantId: string) => void | Promise<void>;
}

/**
 * Managers are enrolled as participants by the snapshot itself; this form only
 * appears when that failed — the derived name was already taken or invalid, or
 * the appointment is full. Without it a co-organizer whose account name collides
 * with an existing participant can never answer their own appointment.
 */
export function ManagerEnrollmentForm({
  publicId,
  enrollmentError,
  onEnrolled,
}: ManagerEnrollmentFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestLock = useRef(false);

  if (enrollmentError === "PARTICIPANT_LIMIT_REACHED") {
    return (
      <section className={styles.joinPanel} aria-labelledby="manager-enrollment-heading">
        <div>
          <p className={styles.joinEyebrow}>Manager access</p>
          <h2 id="manager-enrollment-heading">You manage this appointment</h2>
          <p role="status">
            This appointment has reached its participant limit, so you cannot respond.
          </p>
        </div>
      </section>
    );
  }

  async function enrol(): Promise<void> {
    if (requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/appointments/${publicId}/manager-participant`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        },
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setError(GENERIC_ENROLLMENT_ERROR);
        return;
      }
      if (!response.ok) {
        const parsed = appointmentRouteContracts.createManagerParticipant.errors
          .bodySchema.safeParse(body);
        setError(parsed.success
          ? routeErrorMessage(parsed.data, GENERIC_ENROLLMENT_ERROR)
          : GENERIC_ENROLLMENT_ERROR);
        return;
      }
      const parsed = managerParticipantSuccessSchema.safeParse(body);
      if (!parsed.success) {
        setError(GENERIC_ENROLLMENT_ERROR);
        return;
      }
      await onEnrolled(parsed.data.participantId);
    } catch {
      setError(GENERIC_ENROLLMENT_ERROR);
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void enrol();
  }

  return (
    <section className={styles.joinPanel} aria-labelledby="manager-enrollment-heading">
      <div>
        <p className={styles.joinEyebrow}>Manager access</p>
        <h2 id="manager-enrollment-heading">You manage this appointment</h2>
        <p>Choose a display name to respond and suggest options.</p>
      </div>
      <form
        aria-label="Join as participant"
        className={styles.joinForm}
        onSubmit={submit}
      >
        <label htmlFor="manager-participant-display-name">Display name</label>
        <input
          aria-describedby={error === null ? undefined : "manager-enrollment-error"}
          aria-invalid={error === null ? undefined : true}
          autoComplete="name"
          disabled={pending}
          id="manager-participant-display-name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          name="displayName"
          required
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
        <button disabled={pending} type="submit">
          {pending ? "Joining…" : "Join as participant"}
        </button>
        {error ? (
          <p className={styles.joinError} id="manager-enrollment-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
