const ACTIVE_PARTICIPANT_STORAGE_PREFIX = "appointly:active-participant:";
const PARTICIPANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function activeParticipantStorageKey(publicId: string): string {
  return `${ACTIVE_PARTICIPANT_STORAGE_PREFIX}${publicId}`;
}

function availableStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readActiveParticipantId(
  publicId: string,
  linkedParticipantIds: readonly string[],
  storage?: Storage,
): string | null {
  const target = availableStorage(storage);
  if (target === null) return null;
  const key = activeParticipantStorageKey(publicId);
  try {
    const participantId = target.getItem(key);
    if (
      participantId !== null
      && PARTICIPANT_ID_PATTERN.test(participantId)
      && linkedParticipantIds.includes(participantId)
    ) {
      return participantId;
    }
    if (participantId !== null) target.removeItem(key);
  } catch {
    return null;
  }
  return null;
}

export function storeActiveParticipantId(
  publicId: string,
  participantId: string,
  storage?: Storage,
): void {
  if (!PARTICIPANT_ID_PATTERN.test(participantId)) return;
  const target = availableStorage(storage);
  if (target === null) return;
  try {
    target.setItem(activeParticipantStorageKey(publicId), participantId);
  } catch {
    // Browser privacy settings may disable storage; the server cookie still grants access.
  }
}

export function clearActiveParticipantId(
  publicId: string,
  storage?: Storage,
): void {
  const target = availableStorage(storage);
  if (target === null) return;
  try {
    target.removeItem(activeParticipantStorageKey(publicId));
  } catch {
    // Clearing a missing or unavailable store is already the safe state.
  }
}
