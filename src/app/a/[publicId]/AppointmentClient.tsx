"use client";

import { useRouter } from "next/navigation";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import type { PublicOption } from "../../../features/appointments/server/snapshot";

import {
  appointmentRouteContracts,
  appointmentSnapshotSchema,
  revisionSuccessSchema,
  type AppointmentSnapshot,
  type DeleteAppointmentRequest,
  type DeleteConfirmationDetails,
  type DeleteOptionRequest,
  type FinalizeRequest,
} from "../../../features/appointments/contracts";
import styles from "./appointment.module.css";
import { AppointmentDescriptionEditor } from "./AppointmentDescriptionEditor";
import { AppointmentTitleEditor } from "./AppointmentTitleEditor";
import {
  clearActiveParticipantId,
  readActiveParticipantId,
  storeActiveParticipantId,
} from "./guest-selection-storage";
import { InlineOptionAdd } from "./InlineOptionAdd";
import {
  OptionLabel,
  PublicAppointmentView,
} from "./PublicAppointmentView";
import {
  ResponseControl,
  responseErrorMessage,
  type ResponseValue,
} from "./ResponseControl";

export interface AppointmentClientProps {
  readonly initialSnapshot: AppointmentSnapshot;
}

function savedResponse(
  snapshot: AppointmentSnapshot,
  optionId: string,
): ResponseValue {
  const participantId = snapshot.viewer.activeParticipantId;
  if (participantId === null) return null;
  return snapshot.options.find(({ id }) => id === optionId)?.responses
    .find((response) => response.participantId === participantId)?.value ?? null;
}

function applyResponse(
  snapshot: AppointmentSnapshot,
  optionId: string,
  value: ResponseValue,
  revision: number,
  participantId: string,
): AppointmentSnapshot {
  if (revision < snapshot.appointment.revision) return snapshot;
  if (!snapshot.participants.some(({ id }) => id === participantId)) return snapshot;

  return {
    ...snapshot,
    appointment: { ...snapshot.appointment, revision },
    options: snapshot.options.map((option) => {
      if (option.id !== optionId) return option;
      const responseByParticipant = new Map(
        option.responses.map((response) => (
          [response.participantId, response.value] as const
        )),
      );
      if (value === null) responseByParticipant.delete(participantId);
      else responseByParticipant.set(participantId, value);
      const responses = snapshot.participants.flatMap((participant) => {
        const responseValue = responseByParticipant.get(participant.id);
        return responseValue === undefined
          ? []
          : [{ participantId: participant.id, value: responseValue }];
      });
      return {
        ...option,
        responses,
        yesCount: responses.filter((response) => response.value === "YES").length,
        noCount: responses.filter((response) => response.value === "NO").length,
      };
    }),
  };
}

type AppointmentDetailPatch = Partial<
  Pick<AppointmentSnapshot["appointment"], "title" | "description" | "optionLimit">
>;

/**
 * The same guard as `applyResponse`: a reply that is older than what is already
 * rendered is a race the SSE refresh will settle, so it is dropped rather than
 * allowed to undo newer state.
 */
function applyAppointmentDetails(
  snapshot: AppointmentSnapshot,
  patch: AppointmentDetailPatch,
  revision: number,
): AppointmentSnapshot {
  if (revision < snapshot.appointment.revision) return snapshot;
  return {
    ...snapshot,
    appointment: { ...snapshot.appointment, ...patch, revision },
  };
}

type SnapshotOption = AppointmentSnapshot["options"][number];

interface DeleteConfirmation {
  readonly option: SnapshotOption;
  readonly details: DeleteConfirmationDetails;
  readonly stale: boolean;
  readonly error: string | null;
}

interface RowError {
  readonly optionId: string;
  readonly message: string;
}

interface OptionDeletionOptions {
  readonly publicId: string;
  readonly participantId: string | null;
  readonly onDeleted: (optionId: string, revision: number) => void | Promise<void>;
}

interface OptionDeletion {
  readonly requestDeletion: (
    option: SnapshotOption,
    triggerElement: HTMLButtonElement,
  ) => void;
  readonly pendingOptionId: string | null;
  readonly rowError: RowError | null;
  readonly dialog: ReactNode;
}

const INVALID_DELETE_RESPONSE = "The server returned an invalid deletion response. Try again.";
const GENERIC_DELETE_ERROR = "Could not delete the option. Try again.";

/**
 * The two-phase deletion, unchanged: the same request bodies, the same
 * confirmation and stale-token handling, the same modal focus moves. Only its
 * trigger moved into the option row, so the row-level failure is reported back to
 * the caller instead of rendered in a panel.
 */
function useOptionDeletion({
  publicId,
  participantId,
  onDeleted,
}: OptionDeletionOptions): OptionDeletion {
  const [confirmation, setConfirmation] = useState<DeleteConfirmation | null>(null);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  const requestLock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmationToken = confirmation?.details.token;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || confirmationToken === undefined) return;
    if (!dialog.open) dialog.showModal();
    cancelButtonRef.current?.focus();
  }, [confirmationToken]);

  useEffect(() => {
    // Switching identity used to remount these controls through their key. Keep
    // that reset: a confirmation issued for one participant must never be
    // confirmable as another.
    setConfirmation(null);
    setRowError(null);
  }, [participantId]);

  function closeConfirmation(): void {
    if (requestLock.current) return;
    dialogRef.current?.close();
  }

  function confirmationClosed(): void {
    if (requestLock.current) return;
    setConfirmation(null);
    deleteTriggerRef.current?.focus();
    deleteTriggerRef.current = null;
  }

  function cancelConfirmation(event: SyntheticEvent<HTMLDialogElement>): void {
    if (requestLock.current) event.preventDefault();
  }

  function setConfirmationError(optionId: string, message: string): void {
    setConfirmation((current) => current?.option.id === optionId
      ? { ...current, error: message }
      : current);
  }

  async function deleteOption(
    option: SnapshotOption,
    token?: string,
  ): Promise<void> {
    if (requestLock.current || participantId === null) return;
    requestLock.current = true;
    setPendingOptionId(option.id);
    setRowError(null);
    if (token !== undefined) {
      setConfirmation((current) => current?.option.id === option.id
        ? { ...current, error: null }
        : current);
    }

    try {
      const request: DeleteOptionRequest = token === undefined
        ? { participantId }
        : { participantId, confirmationToken: token };
      const response = await fetch(
        `/api/appointments/${publicId}/options/${option.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(response.ok ? INVALID_DELETE_RESPONSE : GENERIC_DELETE_ERROR);
      }

      if (response.ok) {
        const parsed = revisionSuccessSchema.safeParse(body);
        if (!parsed.success) throw new Error(INVALID_DELETE_RESPONSE);
        await onDeleted(option.id, parsed.data.revision);
        setConfirmation(null);
        return;
      }

      const parsed = appointmentRouteContracts.deleteOption.errors.bodySchema.safeParse(body);
      if (!parsed.success) throw new Error(GENERIC_DELETE_ERROR);
      const { error } = parsed.data;
      if (
        error.code === "DELETE_CONFIRMATION_REQUIRED"
        || error.code === "STALE_DELETE_CONFIRMATION"
      ) {
        setConfirmation({
          option,
          details: error.details,
          stale: error.code === "STALE_DELETE_CONFIRMATION",
          error: null,
        });
        return;
      }

      if (token === undefined) setRowError({ optionId: option.id, message: error.message });
      else setConfirmationError(option.id, error.message);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : GENERIC_DELETE_ERROR;
      if (token === undefined) setRowError({ optionId: option.id, message });
      else setConfirmationError(option.id, message);
    } finally {
      requestLock.current = false;
      setPendingOptionId(null);
    }
  }

  return {
    pendingOptionId,
    rowError,
    requestDeletion(option, triggerElement) {
      deleteTriggerRef.current = triggerElement;
      void deleteOption(option);
    },
    dialog: confirmation ? (
      <dialog
        aria-busy={pendingOptionId !== null}
        aria-describedby="delete-confirmation-description"
        aria-labelledby="delete-confirmation-heading"
        className={styles.deleteDialog}
        data-delete-dialog
        ref={dialogRef}
        onCancel={cancelConfirmation}
        onClose={confirmationClosed}
      >
        <div className={styles.deleteDialogContent}>
          <div>
            <p className={styles.joinEyebrow}>Confirm deletion</p>
            <h2 id="delete-confirmation-heading">
              Delete <OptionLabel option={confirmation.option} />?
            </h2>
          </div>
          {confirmation.stale ? (
            <p className={styles.staleDeleteNotice} role="status">
              Responses changed. Review the current Yes participants and confirm again.
            </p>
          ) : null}
          <p id="delete-confirmation-description">
            Deleting this option also removes these current Yes responses:
          </p>
          <ul className={styles.deleteParticipantList}>
            {confirmation.details.names.map((name, index) => (
              <li data-delete-participant key={`${index}-${name}`}>{name}</li>
            ))}
          </ul>
          {confirmation.error ? (
            <p className={styles.deleteError} role="alert">{confirmation.error}</p>
          ) : null}
          <div className={styles.deleteDialogActions}>
            <button
              data-delete-cancel
              disabled={pendingOptionId !== null}
              ref={cancelButtonRef}
              type="button"
              onClick={closeConfirmation}
            >
              Cancel
            </button>
            <button
              className={styles.confirmDeleteButton}
              data-delete-confirm
              disabled={pendingOptionId !== null}
              type="button"
              onClick={() => void deleteOption(
                confirmation.option,
                confirmation.details.token,
              )}
            >
              {pendingOptionId === confirmation.option.id
                ? "Deleting…"
                : "Delete option"}
            </button>
          </div>
        </div>
      </dialog>
    ) : null,
  };
}

interface FinalizationOptions {
  readonly publicId: string;
  readonly onFinalized: () => void | Promise<void>;
}

interface Finalization {
  readonly finalizeOption: (optionId: string) => void;
  readonly pendingOptionId: string | null;
  readonly error: RowError | null;
}

const INVALID_FINALIZE_RESPONSE =
  "The server returned an invalid finalization response. Try again.";
const GENERIC_FINALIZE_ERROR = "Could not finalize the appointment. Try again.";

/** The row identifies the option, so the old radio-group selection state is gone. */
function useFinalization({ publicId, onFinalized }: FinalizationOptions): Finalization {
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<RowError | null>(null);
  const requestLock = useRef(false);

  async function finalize(optionId: string): Promise<void> {
    if (requestLock.current) return;
    requestLock.current = true;
    setPendingOptionId(optionId);
    setError(null);

    try {
      const request: FinalizeRequest = { optionId };
      const response = await fetch(`/api/appointments/${publicId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(
          response.ok ? INVALID_FINALIZE_RESPONSE : GENERIC_FINALIZE_ERROR,
        );
      }

      if (!response.ok) {
        const parsed = appointmentRouteContracts.finalizeAppointment.errors.bodySchema
          .safeParse(body);
        if (!parsed.success) throw new Error(GENERIC_FINALIZE_ERROR);
        throw new Error(parsed.data.error.message);
      }
      const parsed = revisionSuccessSchema.safeParse(body);
      if (!parsed.success) throw new Error(INVALID_FINALIZE_RESPONSE);
      await onFinalized();
    } catch (caught) {
      setError({
        optionId,
        message: caught instanceof Error ? caught.message : GENERIC_FINALIZE_ERROR,
      });
    } finally {
      requestLock.current = false;
      setPendingOptionId(null);
    }
  }

  return {
    pendingOptionId,
    error,
    finalizeOption(optionId) {
      void finalize(optionId);
    },
  };
}

interface ReopenAppointmentControlsProps {
  readonly publicId: string;
  readonly onReopened: () => void | Promise<void>;
}

const INVALID_REOPEN_RESPONSE =
  "The server returned an invalid reopen response. Try again.";
const GENERIC_REOPEN_ERROR = "Could not reopen the appointment. Try again.";

function ReopenAppointmentControls({
  publicId,
  onReopened,
}: ReopenAppointmentControlsProps) {
  const [pending, setPending] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const requestLock = useRef(false);

  async function reopen(): Promise<void> {
    if (requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setRouteError(null);

    try {
      const response = await fetch(`/api/appointments/${publicId}/reopen`, {
        method: "POST",
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(
          response.ok ? INVALID_REOPEN_RESPONSE : GENERIC_REOPEN_ERROR,
        );
      }
      if (!response.ok) {
        const parsed = appointmentRouteContracts.reopenAppointment.errors.bodySchema
          .safeParse(body);
        if (!parsed.success) throw new Error(GENERIC_REOPEN_ERROR);
        throw new Error(parsed.data.error.message);
      }
      const parsed = revisionSuccessSchema.safeParse(body);
      if (!parsed.success) throw new Error(INVALID_REOPEN_RESPONSE);
      await onReopened();
    } catch (caught) {
      setRouteError(
        caught instanceof Error ? caught.message : GENERIC_REOPEN_ERROR,
      );
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }

  return (
    <section
      aria-busy={pending}
      aria-labelledby="reopen-heading"
      className={styles.finalizePanel}
      data-reopen-panel
    >
      <div>
        <p className={styles.joinEyebrow}>Manager decision</p>
        <h2 id="reopen-heading">Reopen appointment</h2>
        <p>Return this appointment to active status so responses and options can change again.</p>
      </div>
      <button
        data-reopen-appointment
        disabled={pending}
        type="button"
        onClick={() => void reopen()}
      >
        {pending ? "Reopening…" : "Reopen appointment"}
      </button>
      {routeError ? (
        <p className={styles.finalizeError} role="alert">{routeError}</p>
      ) : null}
    </section>
  );
}

interface DeleteAppointmentControlsProps {
  readonly publicId: string;
  readonly title: string;
  readonly onDeleted: () => void | Promise<void>;
}

const GENERIC_APPOINTMENT_DELETE_ERROR =
  "Could not delete the appointment. Try again.";

function DeleteAppointmentControls({
  publicId,
  title,
  onDeleted,
}: DeleteAppointmentControlsProps) {
  const [dialogVisible, setDialogVisible] = useState(false);
  const [titleConfirmation, setTitleConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const requestLock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const titleMatches = titleConfirmation === title.replace(/\r\n?/gu, "\n");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialogVisible) return;
    if (!dialog.open) dialog.showModal();
    titleInputRef.current?.focus();
  }, [dialogVisible]);

  function openConfirmation(event: SyntheticEvent<HTMLButtonElement>): void {
    deleteTriggerRef.current = event.currentTarget;
    setTitleConfirmation("");
    setRouteError(null);
    setDialogVisible(true);
  }

  function closeConfirmation(): void {
    if (requestLock.current) return;
    dialogRef.current?.close();
  }

  function confirmationClosed(): void {
    if (requestLock.current) return;
    setDialogVisible(false);
    setTitleConfirmation("");
    setRouteError(null);
    deleteTriggerRef.current?.focus();
    deleteTriggerRef.current = null;
  }

  function cancelConfirmation(event: SyntheticEvent<HTMLDialogElement>): void {
    if (requestLock.current) event.preventDefault();
  }

  async function deleteAppointment(): Promise<void> {
    if (requestLock.current || !titleMatches) return;
    requestLock.current = true;
    setPending(true);
    setRouteError(null);
    let deleted = false;

    try {
      const request: DeleteAppointmentRequest = { title };
      const response = await fetch(`/api/appointments/${publicId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (response.status === 204) {
        await onDeleted();
        deleted = true;
        return;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(GENERIC_APPOINTMENT_DELETE_ERROR);
      }
      const parsed = appointmentRouteContracts.deleteAppointment.errors.bodySchema
        .safeParse(body);
      if (!parsed.success) throw new Error(GENERIC_APPOINTMENT_DELETE_ERROR);
      throw new Error(parsed.data.error.message);
    } catch (caught) {
      setRouteError(
        caught instanceof Error
          ? caught.message
          : GENERIC_APPOINTMENT_DELETE_ERROR,
      );
    } finally {
      if (!deleted) {
        requestLock.current = false;
        setPending(false);
      }
    }
  }

  return (
    <section
      aria-labelledby="delete-appointment-heading"
      className={styles.deletePanel}
    >
      <div>
        <p className={styles.joinEyebrow}>Owner action</p>
        <h2 id="delete-appointment-heading">Delete appointment</h2>
        <p>Permanently remove this appointment, its options, and all responses.</p>
      </div>
      <button
        className={styles.deleteAppointmentButton}
        data-delete-appointment
        type="button"
        onClick={openConfirmation}
      >
        Delete appointment
      </button>
      {dialogVisible ? (
        <dialog
          aria-busy={pending}
          aria-describedby="delete-appointment-description"
          aria-labelledby="delete-appointment-dialog-heading"
          aria-modal="true"
          className={styles.deleteDialog}
          data-delete-appointment-dialog
          ref={dialogRef}
          onCancel={cancelConfirmation}
          onClose={confirmationClosed}
        >
          <div className={styles.deleteDialogContent}>
            <div>
              <p className={styles.joinEyebrow}>Permanent deletion</p>
              <h2 id="delete-appointment-dialog-heading">
                Delete {title}?
              </h2>
            </div>
            <p id="delete-appointment-description">
              This removes the appointment for everyone and cannot be undone.
            </p>
            <div className={styles.appointmentDeleteField}>
              <label htmlFor="appointment-title-confirmation">
                Enter &quot;{title}&quot; to confirm
              </label>
              <textarea
                aria-describedby={routeError ? "delete-appointment-error" : undefined}
                aria-invalid={routeError === null ? undefined : true}
                autoCapitalize="off"
                autoComplete="off"
                id="appointment-title-confirmation"
                name="appointment-title-confirmation"
                ref={titleInputRef}
                rows={3}
                spellCheck={false}
                value={titleConfirmation}
                onChange={(event) => {
                  setTitleConfirmation(event.currentTarget.value);
                  setRouteError(null);
                }}
              />
            </div>
            {routeError ? (
              <p
                className={styles.deleteError}
                id="delete-appointment-error"
                role="alert"
              >
                {routeError}
              </p>
            ) : null}
            <div className={styles.deleteDialogActions}>
              <button
                data-cancel-delete-appointment
                disabled={pending}
                type="button"
                onClick={closeConfirmation}
              >
                Cancel
              </button>
              <button
                className={styles.confirmDeleteButton}
                data-confirm-delete-appointment
                disabled={pending || !titleMatches}
                type="button"
                onClick={() => void deleteAppointment()}
              >
                {pending ? "Deleting…" : "Delete appointment"}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}

function eventRevision(data: string): number | null {
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = revisionSuccessSchema.safeParse(body);
  return parsed.success ? parsed.data.revision : null;
}

export function AppointmentClient({ initialSnapshot }: AppointmentClientProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [snapshotRefreshError, setSnapshotRefreshError] = useState<string | null>(null);
  const [liveDisconnected, setLiveDisconnected] = useState(false);
  const [participantSelectionPending, setParticipantSelectionPending] = useState(false);
  const [joinedInThisView, setJoinedInThisView] = useState(false);
  const deletedRef = useRef(false);
  const requestSequence = useRef(0);
  const activeParticipantIdRef = useRef(snapshot.viewer.activeParticipantId);
  const latestFullSnapshotRevisionRef = useRef(initialSnapshot.appointment.revision);
  const renderedRevisionRef = useRef(initialSnapshot.appointment.revision);
  const reconnectPendingRef = useRef(false);
  const participantSelectionRequest = useRef<Promise<void> | null>(null);
  activeParticipantIdRef.current = snapshot.viewer.activeParticipantId;
  const publicId = initialSnapshot.appointment.publicId;

  const refreshSnapshot = useCallback(async (participantId: string | null): Promise<boolean> => {
    if (deletedRef.current) return false;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const query = participantId === null
      ? ""
      : `?participantId=${encodeURIComponent(participantId)}`;
    try {
      const response = await fetch(`/api/appointments/${publicId}/snapshot${query}`, {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(responseErrorMessage(body));
      const parsed = appointmentSnapshotSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("The server returned an invalid appointment snapshot.");
      }
      if (requestSequence.current !== sequence) return false;
      const actorChanged = activeParticipantIdRef.current
        !== parsed.data.viewer.activeParticipantId;
      activeParticipantIdRef.current = parsed.data.viewer.activeParticipantId;
      if (parsed.data.appointment.revision >= renderedRevisionRef.current) {
        renderedRevisionRef.current = parsed.data.appointment.revision;
        latestFullSnapshotRevisionRef.current = parsed.data.appointment.revision;
        setSnapshot(parsed.data);
      } else {
        const canDeleteByOptionId = actorChanged
          ? new Map(parsed.data.options.map((option) => [option.id, option.canDelete]))
          : null;
        setSnapshot((current) => ({
          ...current,
          viewer: parsed.data.viewer,
          options: canDeleteByOptionId === null
            ? current.options
            : current.options.map((option) => ({
              ...option,
              canDelete: canDeleteByOptionId.get(option.id) ?? false,
            })),
        }));
      }
      setSnapshotRefreshError(null);
      if (reconnectPendingRef.current) {
        reconnectPendingRef.current = false;
        setLiveDisconnected(false);
      }
      return true;
    } catch (error) {
      if (requestSequence.current !== sequence) return false;
      setSnapshotRefreshError(error instanceof Error
        ? error.message
        : "Could not refresh the appointment.");
      return false;
    }
  }, [publicId]);

  const refreshParticipantSelection = useCallback((participantId: string | null): void => {
    if (deletedRef.current) return;
    setParticipantSelectionPending(true);
    const request = refreshSnapshot(participantId);
    participantSelectionRequest.current = request.then(() => undefined);
    const selectionRequest = participantSelectionRequest.current;
    void selectionRequest.finally(() => {
      if (participantSelectionRequest.current !== selectionRequest) return;
      participantSelectionRequest.current = null;
      setParticipantSelectionPending(false);
    });
  }, [refreshSnapshot]);

  useEffect(() => {
    let disposed = false;
    let refreshInFlight = false;
    let refreshQueued = false;

    async function runLiveRefresh(): Promise<void> {
      if (deletedRef.current) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshQueued = false;
          const selectionRequest = participantSelectionRequest.current;
          if (selectionRequest !== null) await selectionRequest;
          if (disposed || deletedRef.current) return;

          await refreshSnapshot(activeParticipantIdRef.current);
          if (disposed || deletedRef.current) return;
        } while (refreshQueued);
      } finally {
        refreshInFlight = false;
      }
    }

    const source = new EventSource(`/api/appointments/${publicId}/events`);
    source.onopen = () => {
      if (deletedRef.current) return;
      reconnectPendingRef.current = true;
      void runLiveRefresh();
    };
    source.onmessage = (event) => {
      if (deletedRef.current) return;
      const revision = eventRevision(event.data);
      if (
        revision === null
        || revision <= latestFullSnapshotRevisionRef.current
      ) {
        return;
      }
      void runLiveRefresh();
    };
    source.onerror = () => {
      if (deletedRef.current) return;
      reconnectPendingRef.current = false;
      setLiveDisconnected(true);
    };

    return () => {
      disposed = true;
      reconnectPendingRef.current = false;
      source.close();
    };
  }, [publicId, refreshSnapshot]);

  useEffect(() => {
    if (deletedRef.current) return;
    const linkedIds = snapshot.viewer.accessibleParticipants.map(({ id }) => id);
    const storedParticipantId = readActiveParticipantId(publicId, linkedIds);
    if (
      storedParticipantId !== null
      && storedParticipantId !== snapshot.viewer.activeParticipantId
    ) {
      refreshParticipantSelection(storedParticipantId);
    }
  }, [publicId, refreshParticipantSelection, snapshot.viewer.accessibleParticipants, snapshot.viewer.activeParticipantId]);

  const currentViewAccessRevoked = joinedInThisView
    && snapshot.viewer.kind === "anonymous"
    && snapshot.viewer.accessibleParticipants.length === 0
    && !participantSelectionPending
    && snapshotRefreshError === null;

  useEffect(() => {
    if (
      snapshot.appointment.status === "FINALIZED"
      || currentViewAccessRevoked
    ) {
      setJoinedInThisView(false);
    }
  }, [currentViewAccessRevoked, snapshot.appointment.status]);

  const linkedParticipants = snapshot.viewer.accessibleParticipants.map((participant) => ({
    participantId: participant.id,
    displayName: participant.displayName,
  }));

  function participantChanged(participantId: string | null): void {
    refreshParticipantSelection(participantId);
  }

  function participantJoined(participantId: string): void {
    if (deletedRef.current) return;
    storeActiveParticipantId(publicId, participantId);
    setJoinedInThisView(true);
    refreshParticipantSelection(participantId);
  }

  const activeParticipantId = snapshot.viewer.activeParticipantId;
  const optionDeletion = useOptionDeletion({
    publicId,
    participantId: activeParticipantId,
    onDeleted: async (optionId, revision) => {
      renderedRevisionRef.current = Math.max(
        renderedRevisionRef.current,
        revision,
      );
      setSnapshot((current) => ({
        ...current,
        appointment: {
          ...current.appointment,
          revision: Math.max(current.appointment.revision, revision),
        },
        options: current.options.filter(({ id }) => id !== optionId),
      }));
      const selectionRequest = participantSelectionRequest.current;
      if (selectionRequest !== null) await selectionRequest;
      await refreshSnapshot(activeParticipantIdRef.current);
    },
  });
  const finalization = useFinalization({
    publicId,
    onFinalized: async () => {
      const selectionRequest = participantSelectionRequest.current;
      if (selectionRequest !== null) await selectionRequest;
      await refreshSnapshot(activeParticipantIdRef.current);
    },
  });
  const canSuggest = !participantSelectionPending
    && snapshot.appointment.status === "ACTIVE"
    && snapshot.viewer.permissions.canSuggest
    && activeParticipantId !== null;
  const atOptionLimit = snapshot.options.length >= snapshot.appointment.optionLimit;
  const suggestionControls = canSuggest
    ? atOptionLimit
      ? (
        <p className={styles.suggestionLimit} data-suggestion-limit role="status">
          Option limit reached. No more suggestions can be added.
        </p>
      )
      : (
        <InlineOptionAdd
          key={`${activeParticipantId}-${snapshot.appointment.type}`}
          appointmentType={snapshot.appointment.type}
          participantId={activeParticipantId}
          publicId={publicId}
          onAdded={async () => {
            const selectionRequest = participantSelectionRequest.current;
            if (selectionRequest !== null) await selectionRequest;
            await refreshSnapshot(activeParticipantIdRef.current);
          }}
        />
      )
    : null;
  const canDeleteOptions = snapshot.appointment.status === "ACTIVE"
    && activeParticipantId !== null
    && !participantSelectionPending;
  const canFinalize = snapshot.appointment.status === "ACTIVE"
    && snapshot.viewer.kind === "authenticated"
    && snapshot.viewer.permissions.canFinalize;
  const renderOptionActions = canFinalize || canDeleteOptions
    ? (option: PublicOption) => {
      const snapshotOption = snapshot.options.find(({ id }) => id === option.id);
      const finalize = canFinalize ? (
        <form
          aria-label="Finalize appointment"
          className={styles.rowActionForm}
          data-finalize-form={option.id}
          onSubmit={(event) => {
            event.preventDefault();
            finalization.finalizeOption(option.id);
          }}
        >
          <button
            className={styles.rowAction}
            disabled={finalization.pendingOptionId !== null}
            type="submit"
          >
            {finalization.pendingOptionId === option.id ? "Finalizing…" : "Finalize"}
          </button>
          {finalization.error?.optionId === option.id ? (
            <p className={styles.rowActionError} role="alert">
              {finalization.error.message}
            </p>
          ) : null}
        </form>
      ) : null;
      const remove = canDeleteOptions && snapshotOption?.canDelete ? (
        <>
          <button
            aria-describedby={`option-label-${option.id}`}
            aria-label="Delete an option"
            className={styles.rowAction}
            data-delete-option={option.id}
            disabled={optionDeletion.pendingOptionId !== null}
            type="button"
            onClick={(event) => optionDeletion.requestDeletion(
              snapshotOption,
              event.currentTarget,
            )}
          >
            {optionDeletion.pendingOptionId === option.id ? "Deleting…" : "Delete"}
          </button>
          {optionDeletion.rowError?.optionId === option.id ? (
            <p className={styles.rowActionError} role="alert">
              {optionDeletion.rowError.message}
            </p>
          ) : null}
        </>
      ) : null;
      return finalize || remove
        ? <span className={styles.rowActions}>{finalize}{remove}</span>
        : null;
    }
    : undefined;
  const reopenControls = snapshot.appointment.status === "FINALIZED"
    && snapshot.viewer.kind === "authenticated"
    && snapshot.viewer.permissions.canReopen
    ? (
      <ReopenAppointmentControls
        publicId={publicId}
        onReopened={async () => {
          const selectionRequest = participantSelectionRequest.current;
          if (selectionRequest !== null) await selectionRequest;
          await refreshSnapshot(activeParticipantIdRef.current);
        }}
      />
    )
    : null;
  const appointmentDeletionControls = snapshot.viewer.kind === "authenticated"
    && snapshot.viewer.permissions.canDeleteAppointment
    ? (
      <DeleteAppointmentControls
        publicId={publicId}
        title={snapshot.appointment.title}
        onDeleted={() => {
          deletedRef.current = true;
          requestSequence.current += 1;
          participantSelectionRequest.current = null;
          reconnectPendingRef.current = false;
          clearActiveParticipantId(publicId);
          router.replace("/");
        }}
      />
    )
    : null;
  const managementControls = reopenControls === null
    && appointmentDeletionControls === null
    ? null
    : (
      <>
        {reopenControls}
        {appointmentDeletionControls}
      </>
    );
  const respondingParticipantId = !participantSelectionPending
    && snapshot.viewer.permissions.canRespond
    ? activeParticipantId
    : null;
  // The flag is already ACTIVE-only, so a finalized appointment reads as plain text.
  const canEditDetails = snapshot.viewer.permissions.canEditAppointment;

  function detailsSaved(patch: AppointmentDetailPatch, revision: number): void {
    renderedRevisionRef.current = Math.max(renderedRevisionRef.current, revision);
    setSnapshot((current) => applyAppointmentDetails(current, patch, revision));
  }

  function responseSaved(
    optionId: string,
    value: ResponseValue,
    revision: number,
    participantId: string,
  ): void {
    renderedRevisionRef.current = Math.max(renderedRevisionRef.current, revision);
    setSnapshot((current) => applyResponse(
      current,
      optionId,
      value,
      revision,
      participantId,
    ));
  }

  const view = (
    <PublicAppointmentView
      appointment={snapshot}
      linkedParticipants={linkedParticipants}
      activeParticipantId={snapshot.viewer.activeParticipantId}
      onParticipantChange={participantChanged}
      participantSelectionPending={participantSelectionPending}
      onJoined={participantJoined}
      managementControls={managementControls}
      renderTitle={canEditDetails ? () => (
        <AppointmentTitleEditor
          publicId={publicId}
          title={snapshot.appointment.title}
          onSaved={(revision, title) => detailsSaved({ title }, revision)}
        />
      ) : undefined}
      renderDescription={canEditDetails ? () => (
        <AppointmentDescriptionEditor
          description={snapshot.appointment.description}
          publicId={publicId}
          onSaved={(revision, description) => detailsSaved({ description }, revision)}
        />
      ) : undefined}
      readOnly={!snapshot.viewer.permissions.canRespond}
      showJoinForm={!currentViewAccessRevoked && (
        joinedInThisView || (
          snapshot.viewer.accessibleParticipants.length === 0
          && snapshot.viewer.kind === "anonymous"
        )
      )}
      renderResponseControl={respondingParticipantId === null ? undefined : (option) => (
        <ResponseControl
          key={`${respondingParticipantId}-${option.id}`}
          option={option}
          participantId={respondingParticipantId}
          publicId={publicId}
          savedValue={savedResponse(snapshot, option.id)}
          onSaved={responseSaved}
        />
      )}
      renderOptionActions={renderOptionActions}
      suggestionControls={suggestionControls}
      refreshError={liveDisconnected || snapshotRefreshError !== null ? (
        <>
          {liveDisconnected ? <span>Live updates disconnected</span> : null}
          {liveDisconnected && snapshotRefreshError !== null ? " " : null}
          {snapshotRefreshError !== null ? <span>{snapshotRefreshError}</span> : null}
        </>
      ) : null}
      onRefresh={() => void refreshSnapshot(activeParticipantIdRef.current)}
    />
  );

  return (
    <>
      {view}
      {optionDeletion.dialog}
    </>
  );
}
