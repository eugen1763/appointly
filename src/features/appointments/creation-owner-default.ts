import { normalizeParticipantName } from "./validation";

export interface CreationOwnerIdentity {
  readonly name: string;
  readonly email: string;
}

export function ownerDisplayNameFromIdentity(identity: CreationOwnerIdentity): string {
  const normalizedName = normalizeParticipantName(identity.name).displayName;
  if (normalizedName) return normalizedName;

  const email = identity.email.trim();
  const atIndex = email.indexOf("@");
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
  return normalizeParticipantName(localPart).displayName;
}
