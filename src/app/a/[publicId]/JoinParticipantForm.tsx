"use client";

import { useState, type FormEvent } from "react";

import { joinParticipantSuccessSchema } from "../../../features/appointments/contracts";
import styles from "./appointment.module.css";
import { storeActiveParticipantId } from "./guest-selection-storage";

type JoinState =
  | { readonly kind: "form" }
  | { readonly kind: "guest"; readonly editUrl: string }
  | { readonly kind: "manager" };

type CopyStatus =
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };


interface ErrorBody {
  readonly error?: {
    readonly message?: string;
  };
}

export interface JoinParticipantFormProps {
  readonly publicId: string;
  readonly onJoined?: (participantId: string) => void;
}

export function JoinParticipantForm({ publicId, onJoined }: JoinParticipantFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [joinState, setJoinState] = useState<JoinState>({ kind: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${publicId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object"
          && body !== null
          && "error" in body
          ? (body as ErrorBody).error?.message
          : undefined;
        setError(message ?? "Could not join the appointment. Try again.");
        return;
      }
      const parsed = joinParticipantSuccessSchema.safeParse(body);
      if (!parsed.success) {
        setError("Could not join the appointment. Try again.");
        return;
      }
      if ("editUrl" in parsed.data) {
        storeActiveParticipantId(publicId, parsed.data.participantId);
        setJoinState({ kind: "guest", editUrl: parsed.data.editUrl });
      } else {
        setJoinState({ kind: "manager" });
      }
      onJoined?.(parsed.data.participantId);
    } catch {
      setError("Could not join the appointment. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (joinState.kind === "manager") {
    return (
      <section className={styles.joinSuccess} aria-labelledby="join-complete-heading">
        <p className={styles.joinEyebrow}>Participant added</p>
        <h2 id="join-complete-heading">You joined as a co-organizer</h2>
        <p>Your manager access and participant name are ready.</p>
      </section>
    );
  }

  if (joinState.kind === "guest") {
    const editUrl = joinState.editUrl;
    async function copyPrivateLink(): Promise<void> {
      try {
        await navigator.clipboard.writeText(editUrl);
        setCopyStatus({ kind: "success", message: "Private link copied." });
      } catch {
        setCopyStatus({
          kind: "error",
          message: "Copy failed. Open the private edit link and copy it from the address bar.",
        });
      }
    }

    return (
      <section className={styles.joinSuccess} aria-labelledby="private-link-heading">
        <p className={styles.joinEyebrow}>Participant added</p>
        <h2 id="private-link-heading">Save your private edit link</h2>
        <p>This private link appears once. Keep it so you can return to your response.</p>
        <div className={styles.privateLinkActions}>
          <a className={styles.privateLink} href={joinState.editUrl}>Private edit link</a>
          <button className={styles.copyLinkButton} type="button" onClick={copyPrivateLink}>
            Copy private link
          </button>
        </div>
        {copyStatus ? (
          <p
            className={copyStatus.kind === "error" ? styles.joinError : styles.copyStatus}
            role={copyStatus.kind === "error" ? "alert" : "status"}
          >
            {copyStatus.message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className={styles.joinPanel} aria-labelledby="join-heading">
      <div>
        <p className={styles.joinEyebrow}>Add your response</p>
        <h2 id="join-heading">Join this appointment</h2>
        <p>Choose the name other participants will see.</p>
      </div>
      <form className={styles.joinForm} aria-label="Join appointment" onSubmit={submit}>
        <label htmlFor="participant-display-name">Display name</label>
        <input
          id="participant-display-name"
          name="displayName"
          type="text"
          value={displayName}
          maxLength={80}
          autoComplete="name"
          required
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "join-error"}
          onChange={(event) => setDisplayName(event.currentTarget.value)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Joining…" : "Join appointment"}
        </button>
        {error ? <p id="join-error" className={styles.joinError} role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
