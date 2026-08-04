"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  DESCRIPTION_MAX_LENGTH,
  isValidDescriptionLength,
} from "../../../features/appointments/validation";
import routeStyles from "../../routes.module.css";
import { patchAppointmentDetails } from "./appointment-patch";
import styles from "./appointment.module.css";

const TOO_LONG_MESSAGE = "Description must contain at most 2000 characters.";

export interface AppointmentDescriptionEditorProps {
  readonly publicId: string;
  readonly description: string | null;
  readonly onSaved: (revision: number, description: string | null) => void;
}

/**
 * The same direct-manipulation move as the title: the paragraph is the control.
 * Only a fully blank value collapses to null — interior blank lines are the
 * organizer's paragraph breaks, not whitespace to tidy away.
 */
export function AppointmentDescriptionEditor({
  publicId,
  description,
  onSaved,
}: AppointmentDescriptionEditorProps) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestLock = useRef(false);

  useEffect(() => {
    if (!editing) return;
    textareaRef.current?.focus();
  }, [editing]);

  function beginEdit(): void {
    setError(null);
    setEditing(true);
  }

  function cancelEdit(): void {
    if (requestLock.current) return;
    setError(null);
    setEditing(false);
  }

  async function save(): Promise<void> {
    if (requestLock.current) return;
    const typed = textareaRef.current?.value ?? "";
    const next = typed.trim() === "" ? null : typed.trim();
    if (!isValidDescriptionLength(next)) {
      setError(TOO_LONG_MESSAGE);
      return;
    }
    if (next === description) {
      setError(null);
      setEditing(false);
      return;
    }

    requestLock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await patchAppointmentDetails(publicId, { description: next });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onSaved(result.revision, next);
      setEditing(false);
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelEdit();
  }

  if (!editing) {
    const hintId = "description-edit-hint";
    return (
      <>
        <button
          aria-describedby={hintId}
          className={description === null
            ? `${styles.descriptionEditButton} ${styles.descriptionAddButton}`
            : styles.descriptionEditButton}
          type="button"
          onClick={beginEdit}
        >
          {description ?? "Add a description"}
          {description === null ? null : (
            <span aria-hidden="true" className={styles.editGlyph}>✎</span>
          )}
        </button>
        <span className={routeStyles.visuallyHidden} id={hintId}>
          {description === null
            ? "Select to add a description for this appointment."
            : "Select the description to rewrite it."}
        </span>
      </>
    );
  }

  return (
    <form className={styles.descriptionEditor} onSubmit={submit}>
      <textarea
        aria-label="Appointment description"
        defaultValue={description ?? ""}
        disabled={pending}
        maxLength={DESCRIPTION_MAX_LENGTH}
        ref={textareaRef}
        onKeyDown={keyDown}
      />
      <div className={styles.descriptionEditorActions}>
        <button disabled={pending} type="submit">
          {pending ? "Saving…" : "Save description"}
        </button>
        <button disabled={pending} type="button" onClick={cancelEdit}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className={styles.descriptionEditError} role="alert">{error}</p>
      ) : null}
    </form>
  );
}
