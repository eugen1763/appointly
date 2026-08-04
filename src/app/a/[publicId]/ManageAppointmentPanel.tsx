"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  addManagerSuccessSchema,
  appointmentRouteContracts,
  managerListSuccessSchema,
  resetParticipantLinkSuccessSchema,
  revisionSuccessSchema,
  type AppointmentSnapshot,
  type ManagerListSuccess,
} from "../../../features/appointments/contracts";
import {
  COORGANIZER_MAX_COUNT,
  OPTION_LIMIT_MAX,
  OPTION_LIMIT_MIN,
} from "../../../features/appointments/validation";
import { patchAppointmentDetails, routeErrorMessage } from "./appointment-patch";
import styles from "./appointment.module.css";

type Permissions = AppointmentSnapshot["viewer"]["permissions"];
type Participant = AppointmentSnapshot["participants"][number];
type Manager = ManagerListSuccess["managers"][number];

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
const MANAGER_LIST_ERROR =
  "The co-organizer list did not load. Check your connection, then use Retry.";
const MANAGER_ADD_ERROR =
  "The co-organizer was not added. Check your connection and try again.";
const MANAGER_REMOVE_ERROR =
  "The co-organizer was not removed. Check your connection and try again.";

const MANAGER_STATUS_LABELS: Record<Manager["status"], string> = {
  PENDING: "Pending",
  BOUND: "Bound",
};
const RESET_LINK_ERROR =
  "The link could not be reset. Check your connection and try again.";
const COPY_SUCCESS = "Private link copied.";
const COPY_FAILURE =
  "Copy failed. Open the private edit link and copy it from the address bar.";

interface CopyStatus {
  readonly participantId: string;
  readonly kind: "success" | "error";
  readonly message: string;
}

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
  const [managers, setManagers] = useState<readonly Manager[] | null>(null);
  const [managersLoading, setManagersLoading] = useState(false);
  const [managersError, setManagersError] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const managerLock = useRef(false);
  const managersRequested = useRef(false);
  const [confirmingResetId, setConfirmingResetId] = useState<string | null>(null);
  const [resetPendingId, setResetPendingId] = useState<string | null>(null);
  const [resetLinks, setResetLinks] = useState<Readonly<Record<string, string>>>({});
  const [resetErrors, setResetErrors] = useState<Readonly<Record<string, string>>>({});
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);
  const resetLock = useRef(false);

  const canManageCoOrganizers = permissions.canManageCoOrganizers;

  async function loadManagers(): Promise<void> {
    setManagersLoading(true);
    setManagersError(null);
    try {
      const response = await fetch(`/api/appointments/${publicId}/managers`);
      const body: unknown = await response.json();
      if (!response.ok) {
        setManagersError(routeErrorMessage(body, MANAGER_LIST_ERROR));
        return;
      }
      const parsed = managerListSuccessSchema.safeParse(body);
      if (!parsed.success) {
        setManagersError(MANAGER_LIST_ERROR);
        return;
      }
      setManagers(parsed.data.managers);
    } catch {
      setManagersError(MANAGER_LIST_ERROR);
    } finally {
      setManagersLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !canManageCoOrganizers || managersRequested.current) return;
    managersRequested.current = true;
    // Fetched once per mount, on first expand; Retry re-runs it explicitly.
    void loadManagers();
  }, [open, canManageCoOrganizers]);

  const showsAnything = permissions.canEditAppointment
    || canManageCoOrganizers
    || permissions.canResetGuestLinks
    || permissions.canDeleteAppointment;
  if (!showsAnything) return null;

  const coOrganizerCount = (managers ?? [])
    .filter(({ role }) => role === "COORGANIZER").length;

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

  async function addManager(): Promise<void> {
    if (managerLock.current) return;
    managerLock.current = true;
    setAddPending(true);
    setAddError(null);
    try {
      const response = await fetch(`/api/appointments/${publicId}/managers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailDraft }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = appointmentRouteContracts.addManager.errors.bodySchema
          .safeParse(body);
        setAddError(parsed.success
          ? routeErrorMessage(parsed.data, MANAGER_ADD_ERROR)
          : MANAGER_ADD_ERROR);
        return;
      }
      const parsed = addManagerSuccessSchema.safeParse(body);
      if (!parsed.success) {
        setAddError(MANAGER_ADD_ERROR);
        return;
      }
      // The server normalizes the address, so the row shows what was stored.
      const added = parsed.data.manager;
      setManagers((current) => [...current ?? [], added]);
      setEmailDraft("");
    } catch {
      setAddError(MANAGER_ADD_ERROR);
    } finally {
      managerLock.current = false;
      setAddPending(false);
    }
  }

  function submitManager(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void addManager();
  }

  async function resetParticipantLink(participant: Participant): Promise<void> {
    if (resetLock.current) return;
    resetLock.current = true;
    setResetPendingId(participant.id);
    setResetErrors((current) => ({ ...current, [participant.id]: "" }));
    try {
      // Bodyless and headerless: the route accepts no body at all.
      const response = await fetch(
        `/api/appointments/${publicId}/participants/${participant.id}/reset-link`,
        { method: "POST" },
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setResetErrors((current) => ({ ...current, [participant.id]: RESET_LINK_ERROR }));
        return;
      }
      if (!response.ok) {
        /*
         * safeParse, never parse: this route can emit a 500 INTERNAL_ERROR that
         * its own contract does not list, and a throw here would lose the row.
         */
        const parsed = appointmentRouteContracts.resetParticipantLink.errors
          .bodySchema.safeParse(body);
        setResetErrors((current) => ({
          ...current,
          [participant.id]: parsed.success
            ? routeErrorMessage(parsed.data, RESET_LINK_ERROR)
            : RESET_LINK_ERROR,
        }));
        return;
      }
      const parsed = resetParticipantLinkSuccessSchema.safeParse(body);
      if (!parsed.success) {
        setResetErrors((current) => ({ ...current, [participant.id]: RESET_LINK_ERROR }));
        return;
      }
      setResetLinks((current) => ({
        ...current,
        [participant.id]: parsed.data.editUrl,
      }));
      setConfirmingResetId(null);
      setCopyStatus(null);
    } catch {
      setResetErrors((current) => ({ ...current, [participant.id]: RESET_LINK_ERROR }));
    } finally {
      resetLock.current = false;
      setResetPendingId(null);
    }
  }

  async function copyPrivateLink(participantId: string, editUrl: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(editUrl);
      setCopyStatus({ participantId, kind: "success", message: COPY_SUCCESS });
    } catch {
      setCopyStatus({ participantId, kind: "error", message: COPY_FAILURE });
    }
  }

  async function removeManager(manager: Manager): Promise<void> {
    if (managerLock.current) return;
    managerLock.current = true;
    setRemovingId(manager.id);
    setAddError(null);
    try {
      // The route rejects any body at all, so none is sent and no headers either.
      const response = await fetch(
        `/api/appointments/${publicId}/managers/${manager.id}`,
        { method: "DELETE" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsed = appointmentRouteContracts.deleteManager.errors.bodySchema
          .safeParse(body);
        setAddError(parsed.success
          ? routeErrorMessage(parsed.data, MANAGER_REMOVE_ERROR)
          : MANAGER_REMOVE_ERROR);
        return;
      }
      if (!revisionSuccessSchema.safeParse(body).success) {
        setAddError(MANAGER_REMOVE_ERROR);
        return;
      }
      setManagers((current) => (current ?? []).filter(({ id }) => id !== manager.id));
    } catch {
      setAddError(MANAGER_REMOVE_ERROR);
    } finally {
      managerLock.current = false;
      setRemovingId(null);
    }
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
                <div className={`${styles.manageField} ${styles.manageFieldNarrow}`}>
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
          {canManageCoOrganizers ? (
            <section
              aria-labelledby="manage-co-organizers-heading"
              className={styles.manageSection}
            >
              <h2 id="manage-co-organizers-heading">Co-organizers</h2>
              <p className={styles.manageHint}>
                {coOrganizerCount} of {COORGANIZER_MAX_COUNT} co-organizers
              </p>
              {managersLoading ? (
                <p className={styles.manageHint} role="status">Loading co-organizers…</p>
              ) : null}
              {managersError ? (
                <p className={styles.manageError} role="alert">
                  {managersError}{" "}
                  <button type="button" onClick={() => void loadManagers()}>Retry</button>
                </p>
              ) : null}
              {managers !== null ? (
                <ul aria-label="Co-organizers" className={styles.managerList}>
                  {managers.map((manager) => (
                    <li key={manager.id}>
                      <span className={styles.managerEmail}>{manager.email}</span>
                      <span className={styles.managerStatus}>
                        {manager.role === "OWNER"
                          ? "Owner"
                          : MANAGER_STATUS_LABELS[manager.status]}
                      </span>
                      {manager.canRemove ? (
                        <button
                          aria-label={`Remove ${manager.email}`}
                          disabled={removingId !== null || addPending}
                          type="button"
                          onClick={() => void removeManager(manager)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <form className={styles.manageForm} onSubmit={submitManager}>
                <div className={styles.manageField}>
                  <label htmlFor="manage-co-organizer-email">Co-organizer email</label>
                  <input
                    aria-describedby={addError ? "manage-co-organizer-error" : undefined}
                    aria-invalid={addError === null ? undefined : true}
                    autoComplete="email"
                    disabled={addPending}
                    id="manage-co-organizer-email"
                    required
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.currentTarget.value)}
                  />
                </div>
                <button disabled={addPending} type="submit">
                  {addPending ? "Adding…" : "Add co-organizer"}
                </button>
              </form>
              {addError ? (
                <p
                  className={styles.manageError}
                  id="manage-co-organizer-error"
                  role="alert"
                >
                  {addError}
                </p>
              ) : null}
            </section>
          ) : null}
          {permissions.canResetGuestLinks && participants.length > 0 ? (
            <section
              aria-labelledby="manage-guest-links-heading"
              className={styles.manageSection}
            >
              <h2 id="manage-guest-links-heading">Guest links</h2>
              <p className={styles.manageHint}>
                Reissue a participant&apos;s private edit link. The previous link
                stops working immediately.
              </p>
              <ul aria-label="Guest links" className={styles.participantList}>
                {participants.map((participant) => {
                  const editUrl = resetLinks[participant.id];
                  const rowError = resetErrors[participant.id];
                  const confirming = confirmingResetId === participant.id;
                  return (
                    <li key={participant.id}>
                      <span className={styles.participantName}>
                        {participant.displayName}
                      </span>
                      {confirming ? (
                        <span className={styles.resetConfirm}>
                          <span>
                            Reset the link for {participant.displayName}? The
                            current link stops working.
                          </span>
                          <button
                            disabled={resetPendingId !== null}
                            type="button"
                            onClick={() => void resetParticipantLink(participant)}
                          >
                            {resetPendingId === participant.id
                              ? "Resetting…"
                              : "Confirm reset"}
                          </button>
                          <button
                            disabled={resetPendingId !== null}
                            type="button"
                            onClick={() => setConfirmingResetId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          aria-label={`Reset link for ${participant.displayName}`}
                          type="button"
                          onClick={() => {
                            setConfirmingResetId(participant.id);
                            setResetErrors((current) => ({
                              ...current,
                              [participant.id]: "",
                            }));
                          }}
                        >
                          Reset link
                        </button>
                      )}
                      {editUrl === undefined ? null : (
                        <div
                          aria-label={`New private edit link for ${participant.displayName}`}
                          className={styles.resetResult}
                          role="group"
                        >
                          <a className={styles.privateLink} href={editUrl}>
                            Private edit link
                          </a>
                          <button
                            className={styles.copyLinkButton}
                            type="button"
                            onClick={() => void copyPrivateLink(participant.id, editUrl)}
                          >
                            Copy private link
                          </button>
                          <span className={styles.manageHint}>
                            This link appears once. The previous link no longer works.
                          </span>
                          {copyStatus?.participantId === participant.id ? (
                            <span
                              className={copyStatus.kind === "error"
                                ? styles.manageError
                                : styles.manageHint}
                              role={copyStatus.kind === "error" ? "alert" : "status"}
                            >
                              {copyStatus.message}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {rowError ? (
                        <p className={styles.manageError} role="alert">{rowError}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {permissions.canDeleteAppointment ? deleteControls : null}
        </div>
      ) : null}
    </div>
  );
}
