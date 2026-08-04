"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  isValidTitleLength,
  TITLE_MAX_LENGTH,
} from "../../../features/appointments/validation";
import routeStyles from "../../routes.module.css";
import { patchAppointmentDetails } from "./appointment-patch";
import styles from "./appointment.module.css";

const BLANK_TITLE_MESSAGE = "Title must contain 1 to 120 characters";

export interface AppointmentTitleEditorProps {
  readonly publicId: string;
  readonly title: string;
  readonly onSaved: (revision: number, title: string) => void;
}

/**
 * The heading is the control: renaming starts where the name already is, so no
 * separate form has to be found first. The ✎ is aria-hidden and the rename hint
 * sits outside the heading as a description, because the heading's accessible
 * name must stay exactly the title.
 */
export function AppointmentTitleEditor({
  publicId,
  title,
  onSaved,
}: AppointmentTitleEditorProps) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestLock = useRef(false);
  /*
   * Escape unmounts the input; in Chromium a focusout follows and must not commit.
   * Firefox and WebKit fire nothing on removal, so the flag would still be set when
   * the next edit opens and would swallow that rename — beginEdit clears it.
   */
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [editing]);

  function beginEdit(): void {
    cancelledRef.current = false;
    setError(null);
    setEditing(true);
  }

  function cancelEdit(): void {
    if (requestLock.current) return;
    cancelledRef.current = true;
    setError(null);
    setEditing(false);
  }

  async function commit(): Promise<void> {
    if (requestLock.current) return;
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = inputRef.current?.value ?? title;
    if (!isValidTitleLength(next)) {
      setError(BLANK_TITLE_MESSAGE);
      return;
    }
    // A no-op PATCH costs a round trip and publishes nothing; blur must stay cheap.
    if (next === title) {
      setError(null);
      setEditing(false);
      return;
    }

    requestLock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await patchAppointmentDetails(publicId, { title: next });
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

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

  if (!editing) {
    return (
      <>
        <h1>
          <button
            aria-describedby="title-edit-hint"
            className={styles.titleEditButton}
            type="button"
            onClick={beginEdit}
          >
            {title}
            <span aria-hidden="true" className={styles.editGlyph}>✎</span>
          </button>
        </h1>
        <span className={routeStyles.visuallyHidden} id="title-edit-hint">
          Select the title to rename this appointment.
        </span>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.titleEditing}>
        <input
          aria-describedby={error !== null ? "title-edit-error" : undefined}
          aria-invalid={error !== null}
          aria-label="Appointment title"
          defaultValue={title}
          disabled={pending}
          maxLength={TITLE_MAX_LENGTH}
          ref={inputRef}
          type="text"
          onBlur={() => void commit()}
          onKeyDown={keyDown}
        />
      </h1>
      {error ? (
        <p className={styles.titleEditError} id="title-edit-error" role="alert">{error}</p>
      ) : null}
    </>
  );
}
