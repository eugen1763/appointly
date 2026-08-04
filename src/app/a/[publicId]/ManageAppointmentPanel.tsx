"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";

import type { AppointmentSnapshot } from "../../../features/appointments/contracts";
import {
  OPTION_LIMIT_MAX,
  OPTION_LIMIT_MIN,
} from "../../../features/appointments/validation";
import { patchAppointmentDetails } from "./appointment-patch";
import styles from "./appointment.module.css";

type Permissions = AppointmentSnapshot["viewer"]["permissions"];
type Participant = AppointmentSnapshot["participants"][number];

export interface ManageAppointmentPanelProps {
  readonly publicId: string;
  readonly permissions: Permissions;
  readonly optionCount: number;
  readonly optionLimit: number;
  readonly participants: readonly Participant[];
  readonly onDetailsSaved: (
    revision: number,
    patch: { readonly optionLimit: number },
  ) => void;
  readonly deleteControls: ReactNode;
}

const INVALID_LIMIT_MESSAGE =
  `Option limit must be an integer from ${OPTION_LIMIT_MIN} to ${OPTION_LIMIT_MAX}.`;

/**
 * Administration and destruction, one quiet surface away from the board. The
 * panel is unmounted while closed, so every piece of state it owns lives here
 * rather than in the sections — a reissued guest link would otherwise be
 * destroyed by collapsing the panel, and it is only ever shown once.
 */
export function ManageAppointmentPanel({
  publicId,
  permissions,
  optionCount,
  optionLimit,
  participants,
  onDetailsSaved,
  deleteControls,
}: ManageAppointmentPanelProps) {
  const [open, setOpen] = useState(false);
  const [limitDraft, setLimitDraft] = useState(String(optionLimit));
  const [limitPending, setLimitPending] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const limitLock = useRef(false);

  const showsAnything = permissions.canEditAppointment
    || permissions.canManageCoOrganizers
    || permissions.canResetGuestLinks
    || permissions.canDeleteAppointment;
  if (!showsAnything) return null;

  async function saveOptionLimit(): Promise<void> {
    if (limitLock.current) return;
    const next = Number(limitDraft);
    if (!Number.isInteger(next) || next < OPTION_LIMIT_MIN || next > OPTION_LIMIT_MAX) {
      setLimitError(INVALID_LIMIT_MESSAGE);
      return;
    }
    if (next === optionLimit) {
      setLimitError(null);
      return;
    }

    limitLock.current = true;
    setLimitPending(true);
    setLimitError(null);
    try {
      const result = await patchAppointmentDetails(publicId, { optionLimit: next });
      if (!result.ok) {
        setLimitError(result.message);
        return;
      }
      onDetailsSaved(result.revision, { optionLimit: next });
    } finally {
      limitLock.current = false;
      setLimitPending(false);
    }
  }

  function submitOptionLimit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void saveOptionLimit();
  }

  return (
    <div className={styles.managePanel}>
      <button
        aria-controls="manage-panel"
        aria-expanded={open}
        className={styles.manageToggle}
        type="button"
        onClick={() => setOpen(!open)}
      >
        Manage appointment
      </button>
      {open ? (
        <div className={styles.managePanelBody} id="manage-panel">
          {permissions.canEditAppointment ? (
            <section
              aria-labelledby="manage-option-limit-heading"
              className={styles.manageSection}
            >
              <h2 id="manage-option-limit-heading">Option limit</h2>
              <p className={styles.manageHint}>
                Currently {optionCount} of {optionLimit} options used.
              </p>
              <form className={styles.manageForm} onSubmit={submitOptionLimit}>
                <div className={styles.manageField}>
                  <label htmlFor="manage-option-limit">Option limit</label>
                  <input
                    aria-describedby={limitError ? "manage-option-limit-error" : undefined}
                    aria-invalid={limitError === null ? undefined : true}
                    disabled={limitPending}
                    id="manage-option-limit"
                    inputMode="numeric"
                    max={OPTION_LIMIT_MAX}
                    min={OPTION_LIMIT_MIN}
                    step="1"
                    type="number"
                    value={limitDraft}
                    onChange={(event) => setLimitDraft(event.currentTarget.value)}
                  />
                </div>
                <button disabled={limitPending} type="submit">
                  {limitPending ? "Saving…" : "Save option limit"}
                </button>
              </form>
              {limitError ? (
                <p
                  className={styles.manageError}
                  id="manage-option-limit-error"
                  role="alert"
                >
                  {limitError}
                </p>
              ) : null}
            </section>
          ) : null}
          {permissions.canDeleteAppointment ? deleteControls : null}
        </div>
      ) : null}
    </div>
  );
}
