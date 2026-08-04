import type { OptionInput } from "../contracts";

import type { appointmentOptions } from "../../../db/schema";

export type OptionStorageInput =
  | { kind: "DATE"; startDate: string }
  | { kind: "DATE_TIME"; startAt: number }
  | { kind: "DATE_RANGE"; startDate: string; endDate: string }
  | { kind: "DATE_TIME_RANGE"; startAt: number; endAt: number };

export type OptionStorageValues = Required<
  Pick<
    typeof appointmentOptions.$inferInsert,
    "startDate" | "endDate" | "startAt" | "endAt" | "canonicalKey"
  >
>;

export type OptionInputField =
  | "startDate"
  | "endDate"
  | "startAt"
  | "endAt";

export type OptionInputValidation =
  | { success: true; values: OptionStorageValues }
  | {
      success: false;
      fieldErrors: Partial<Record<OptionInputField, string[]>>;
    };

export interface OptionCreationTime {
  readonly now: number;
  readonly currentDate: string;
}

export type OptionStartValidation =
  | { success: true }
  | {
      success: false;
      fieldErrors: Partial<
        Record<Extract<OptionInputField, "startDate" | "startAt">, string[]>
      >;
    };

export class InvalidTimeZoneError extends Error {
  constructor(cause: unknown) {
    super("The submitted time zone is invalid.", { cause });
    this.name = "InvalidTimeZoneError";
  }
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DATE_ERROR = "Use YYYY-MM-DD with a real calendar date.";
const TIME_ERROR =
  "Use canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ with a real date and time.";
const DATE_RANGE_ERROR = "End date must be on or after start date.";
const TIME_RANGE_ERROR =
  "End date and time must be after start date and time.";
const DATE_PAST_ERROR = "Start date must be today or later.";
const TIME_PAST_ERROR = "Start date and time must be now or later.";

function isValidDateOnly(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

  const daysInMonth =
    month === 2
      ? leapYear ? 29 : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  return day <= daysInMonth;
}

function canonicalUtcMilliseconds(value: string): number | null {
  if (!CANONICAL_UTC_PATTERN.test(value)) return null;

  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds)
    || !Number.isSafeInteger(milliseconds)
  ) {
    return null;
  }
  return new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

export function optionCreationTime(
  timeZone: string,
  now: number,
): OptionCreationTime {
  if (!Number.isSafeInteger(now)) {
    throw new RangeError("The clock must return safe integer milliseconds.");
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch (cause) {
    if (cause instanceof RangeError) {
      throw new InvalidTimeZoneError(cause);
    }
    throw cause;
  }

  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (
    year === undefined
    || month === undefined
    || day === undefined
    || !/^\d{4}$/u.test(year)
    || !/^\d{2}$/u.test(month)
    || !/^\d{2}$/u.test(day)
  ) {
    throw new RangeError("The time-zone formatter returned an invalid date.");
  }

  return {
    now,
    currentDate: `${year}-${month}-${day}`,
  };
}

export function validateOptionStartForCreation(
  option: OptionStorageValues,
  creationTime: OptionCreationTime,
): OptionStartValidation {
  if (option.startDate !== null) {
    return option.startDate < creationTime.currentDate
      ? {
          success: false,
          fieldErrors: { startDate: [DATE_PAST_ERROR] },
        }
      : { success: true };
  }
  if (option.startAt === null) {
    throw new RangeError("An option must have a start value.");
  }
  return option.startAt < creationTime.now
    ? {
        success: false,
        fieldErrors: { startAt: [TIME_PAST_ERROR] },
      }
    : { success: true };
}

export function validateOptionInputForStorage(
  option: OptionInput,
): OptionInputValidation {
  switch (option.kind) {
    case "DATE":
      if (!isValidDateOnly(option.startDate)) {
        return {
          success: false,
          fieldErrors: { startDate: [DATE_ERROR] },
        };
      }
      return {
        success: true,
        values: toOptionStorageValues(option),
      };
    case "DATE_TIME": {
      const startAt = canonicalUtcMilliseconds(option.startAt);
      if (startAt === null) {
        return {
          success: false,
          fieldErrors: { startAt: [TIME_ERROR] },
        };
      }
      return {
        success: true,
        values: toOptionStorageValues({ kind: option.kind, startAt }),
      };
    }
    case "DATE_RANGE": {
      const fieldErrors: Partial<
        Record<"startDate" | "endDate", string[]>
      > = {};
      if (!isValidDateOnly(option.startDate)) {
        fieldErrors.startDate = [DATE_ERROR];
      }
      if (!isValidDateOnly(option.endDate)) {
        fieldErrors.endDate = [DATE_ERROR];
      }
      if (Object.keys(fieldErrors).length > 0) {
        return { success: false, fieldErrors };
      }
      if (option.endDate < option.startDate) {
        return {
          success: false,
          fieldErrors: { endDate: [DATE_RANGE_ERROR] },
        };
      }
      return {
        success: true,
        values: toOptionStorageValues(option),
      };
    }
    case "DATE_TIME_RANGE": {
      const startAt = canonicalUtcMilliseconds(option.startAt);
      const endAt = canonicalUtcMilliseconds(option.endAt);
      if (startAt === null || endAt === null) {
        const fieldErrors: Partial<
          Record<"startAt" | "endAt", string[]>
        > = {};
        if (startAt === null) fieldErrors.startAt = [TIME_ERROR];
        if (endAt === null) fieldErrors.endAt = [TIME_ERROR];
        return { success: false, fieldErrors };
      }
      if (endAt <= startAt) {
        return {
          success: false,
          fieldErrors: { endAt: [TIME_RANGE_ERROR] },
        };
      }
      return {
        success: true,
        values: toOptionStorageValues({
          kind: option.kind,
          startAt,
          endAt,
        }),
      };
    }
  }
}

function assertSafeMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Timed option values must be safe integer milliseconds");
  }
}

export function toOptionStorageValues(
  option: OptionStorageInput,
): OptionStorageValues {
  switch (option.kind) {
    case "DATE":
      return {
        startDate: option.startDate,
        endDate: null,
        startAt: null,
        endAt: null,
        canonicalKey: `D:${option.startDate}`,
      };
    case "DATE_TIME":
      assertSafeMilliseconds(option.startAt);
      return {
        startDate: null,
        endDate: null,
        startAt: option.startAt,
        endAt: null,
        canonicalKey: `T:${option.startAt}`,
      };
    case "DATE_RANGE":
      if (option.endDate < option.startDate) {
        throw new RangeError("Date range end must not precede its start");
      }
      return {
        startDate: option.startDate,
        endDate: option.endDate,
        startAt: null,
        endAt: null,
        canonicalKey: `DR:${option.startDate}/${option.endDate}`,
      };
    case "DATE_TIME_RANGE":
      assertSafeMilliseconds(option.startAt);
      assertSafeMilliseconds(option.endAt);
      if (option.endAt <= option.startAt) {
        throw new RangeError("Timed range end must be after its start");
      }
      return {
        startDate: null,
        endDate: null,
        startAt: option.startAt,
        endAt: option.endAt,
        canonicalKey: `TR:${option.startAt}/${option.endAt}`,
      };
  }
}
