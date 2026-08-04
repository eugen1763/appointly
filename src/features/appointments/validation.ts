export const DISPLAY_NAME_MIN_LENGTH = 1;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 2_000;
export const COORGANIZER_MAX_COUNT = 20;
export const PARTICIPANT_MAX_COUNT = 200;
export const OPTION_LIMIT_MIN = 1;
export const OPTION_LIMIT_MAX = 100;

export interface NormalizedParticipantName {
  displayName: string;
  normalizedName: string;
}

function countCodePoints(value: string): number {
  let count = 0;
  for (const _codePoint of value) {
    count += 1;
  }
  return count;
}

function hasCodePointLength(value: string, minimum: number, maximum: number): boolean {
  const length = countCodePoints(value);
  return length >= minimum && length <= maximum;
}

function isIntegerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function normalizeParticipantName(input: string): NormalizedParticipantName {
  const displayName = input.normalize("NFKC").trim().replace(/\s+/gu, " ");

  return {
    displayName,
    normalizedName: displayName.toLowerCase(),
  };
}

export function isValidDisplayNameLength(value: string): boolean {
  return hasCodePointLength(value, DISPLAY_NAME_MIN_LENGTH, DISPLAY_NAME_MAX_LENGTH);
}

export function isValidTitleLength(value: string): boolean {
  return value.trim().length > 0
    && hasCodePointLength(value, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH);
}

export function isValidDescriptionLength(value: string | null): boolean {
  return value === null || hasCodePointLength(value, 0, DESCRIPTION_MAX_LENGTH);
}

export function isValidCoOrganizerCount(value: number): boolean {
  return isIntegerInRange(value, 0, COORGANIZER_MAX_COUNT);
}

export function isValidParticipantCount(value: number): boolean {
  return isIntegerInRange(value, 0, PARTICIPANT_MAX_COUNT);
}

export function isValidOptionLimit(value: number): boolean {
  return isIntegerInRange(value, OPTION_LIMIT_MIN, OPTION_LIMIT_MAX);
}

export interface AppointmentDetailValues {
  readonly title?: string;
  readonly description?: string | null;
  readonly optionLimit?: number;
}

export type AppointmentDetailFieldErrors = Record<string, string[]>;

export function appointmentDetailFieldErrors(
  values: AppointmentDetailValues,
): AppointmentDetailFieldErrors {
  const fieldErrors: AppointmentDetailFieldErrors = {};
  if (values.title !== undefined && !isValidTitleLength(values.title)) {
    fieldErrors.title = ["Title must contain 1 to 120 characters."];
  }
  if (
    values.description !== undefined
    && !isValidDescriptionLength(values.description)
  ) {
    fieldErrors.description = ["Description must contain at most 2000 characters."];
  }
  if (
    values.optionLimit !== undefined
    && !isValidOptionLimit(values.optionLimit)
  ) {
    fieldErrors.optionLimit = ["Option limit must be an integer from 1 to 100."];
  }
  return fieldErrors;
}

export function hasOptionCapacity(currentOptionCount: number, optionLimit: number): boolean {
  return Number.isInteger(currentOptionCount)
    && currentOptionCount >= 0
    && isValidOptionLimit(optionLimit)
    && currentOptionCount < optionLimit;
}
