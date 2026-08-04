"use client";

import { useEffect, useState, type ChangeEvent } from "react";

import type { LinkedGuestParticipant } from "../../../features/appointments/server/guest-session";
import styles from "./appointment.module.css";
import {
  clearActiveParticipantId,
  readActiveParticipantId,
  storeActiveParticipantId,
} from "./guest-selection-storage";

export interface GuestIdentitySelectorProps {
  readonly publicId: string;
  readonly linkedParticipants: readonly LinkedGuestParticipant[];
  readonly activeParticipantId?: string | null;
  readonly onParticipantChange?: (participantId: string | null) => void;
  readonly disabled?: boolean;
}

export function GuestIdentitySelector({
  publicId,
  linkedParticipants,
  activeParticipantId: controlledParticipantId,
  onParticipantChange,
  disabled = false,
}: GuestIdentitySelectorProps) {
  const onlyParticipant = linkedParticipants.length === 1 ? linkedParticipants[0] : null;
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(
    controlledParticipantId ?? onlyParticipant?.participantId ?? null,
  );
  const controlledParticipantIsLinked = controlledParticipantId !== undefined
    && controlledParticipantId !== null
    && linkedParticipants.some(
      ({ participantId }) => participantId === controlledParticipantId,
    );

  useEffect(() => {
    if (controlledParticipantId === undefined) return;
    setActiveParticipantId(controlledParticipantId);
    if (controlledParticipantId !== null && controlledParticipantIsLinked) {
      storeActiveParticipantId(publicId, controlledParticipantId);
    }
  }, [controlledParticipantId, controlledParticipantIsLinked, publicId]);

  useEffect(() => {
    if (controlledParticipantId !== undefined) return;
    if (linkedParticipants.length === 1) {
      const participantId = linkedParticipants[0]?.participantId ?? null;
      setActiveParticipantId(participantId);
      if (participantId !== null) storeActiveParticipantId(publicId, participantId);
      return;
    }
    const linkedIds = linkedParticipants.map((participant) => participant.participantId);
    setActiveParticipantId(readActiveParticipantId(publicId, linkedIds));
  }, [controlledParticipantId, linkedParticipants, publicId]);

  if (linkedParticipants.length === 0) return null;
  if (onlyParticipant !== null) {
    return (
      <section className={styles.returnIdentity} aria-label="Saved participant">
        <p>Returning as <strong>{onlyParticipant.displayName}</strong></p>
      </section>
    );
  }

  function chooseParticipant(event: ChangeEvent<HTMLSelectElement>): void {
    const participantId = event.currentTarget.value || null;
    setActiveParticipantId(participantId);
    if (participantId === null) {
      clearActiveParticipantId(publicId);
    } else {
      storeActiveParticipantId(publicId, participantId);
    }
    onParticipantChange?.(participantId);
  }

  return (
    <section className={styles.returnIdentity} aria-labelledby="return-participant-label">
      <label id="return-participant-label" htmlFor="return-participant">
        Choose your saved participant
      </label>
      <select
        id="return-participant"
        value={activeParticipantId ?? ""}
        disabled={disabled}
        onChange={chooseParticipant}
      >
        <option value="">Choose a participant</option>
        {linkedParticipants.map((participant) => (
          <option key={participant.participantId} value={participant.participantId}>
            {participant.displayName}
          </option>
        ))}
      </select>
    </section>
  );
}
