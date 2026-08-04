"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { formatCalendarDate } from "../../app/a/[publicId]/calendar-date";
import styles from "../../app/routes.module.css";
import { normalizeEmail } from "../../lib/email";
import { MonthGrid, isoDate, type MonthCursor } from "./MonthGrid";
import {
  type CreateAppointmentInput,
  type CreateAppointmentSuccess,
  type OptionInput,
} from "./contracts";
import {
  CreateAppointmentRequestError,
  submitCreateAppointment,
  type CreateAppointmentSubmit,
} from "./create-appointment-client";
import { localTimeToUtc } from "./local-date-time";
import {
  COORGANIZER_MAX_COUNT,
  DESCRIPTION_MAX_LENGTH,
  DISPLAY_NAME_MAX_LENGTH,
  OPTION_LIMIT_MAX,
  OPTION_LIMIT_MIN,
  TITLE_MAX_LENGTH,
  isValidDescriptionLength,
  isValidDisplayNameLength,
  isValidTitleLength,
  normalizeParticipantName,
} from "./validation";

type AppointmentType = CreateAppointmentInput["type"];
type AdvancedField =
  | "description"
  | "ownerDisplayName"
  | "optionLimit"
  | "coOrganizerEmail"
  | "coOrganizerEmails";
type AdvancedErrors = Partial<Record<AdvancedField, string>>;
type CopyState = "IDLE" | "COPYING" | "COPIED" | "FAILED";

interface DayTime {
  readonly start?: string;
  readonly end?: string;
}

interface BuiltOptions {
  readonly type: AppointmentType;
  readonly options: OptionInput[];
  readonly optionLabels: string[];
  readonly optionDays: string[][];
}

interface LastSubmission {
  readonly input: CreateAppointmentInput;
  readonly optionLabels: readonly string[];
  readonly optionDays: readonly (readonly string[])[];
}

export interface AppointmentComposerProps {
  readonly defaultOwnerDisplayName: string;
  readonly submit?: CreateAppointmentSubmit;
  readonly copyText?: (text: string) => Promise<void>;
  readonly now?: () => Date;
}

const TYPE_WORDS: Record<AppointmentType, string> = {
  DATE: "Whole days",
  DATE_TIME: "Days at a time",
  DATE_RANGE: "One run of days",
  DATE_TIME_RANGE: "A run, with times",
};

/* DATE_TIME_RANGE covers two different shapes: one combined multi-day run, and
   N independent same-day options that each carry a start and an end. "A run,
   with times" is only true of the first, so the uncombined shape gets its own
   sentence. Both still emit data-inferred-type="DATE_TIME_RANGE". */
const SAME_DAY_SPAN_WORDS = "Days with a start and end";

function todayIsoFrom(current: Date): string {
  return isoDate(current.getFullYear(), current.getMonth(), current.getDate());
}

function monthCursorFrom(current: Date): MonthCursor {
  return { year: current.getFullYear(), monthIndex: current.getMonth() };
}

function nextIsoDay(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const monthIndex = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  const next = new Date(Date.UTC(year, monthIndex, day + 1));
  return isoDate(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
}

function isConsecutiveRun(days: readonly string[]): boolean {
  return days.length >= 2
    && days.every((day, index) => index === 0 || nextIsoDay(days[index - 1]) === day);
}

function defaultCopyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function AppointmentComposer({
  defaultOwnerDisplayName,
  submit = submitCreateAppointment,
  copyText = defaultCopyText,
  now = () => new Date(),
}: AppointmentComposerProps) {
  const router = useRouter();
  const [today, setToday] = useState(() => todayIsoFrom(now()));
  const [monthCursor, setMonthCursor] = useState<MonthCursor>(() => monthCursorFrom(now()));

  /* The first paint carries the server's calendar day. A browser a day ahead of
     or behind the server would otherwise keep the server's disabled/data-today
     attributes forever, because React does not patch attribute-only hydration
     mismatches — today would stay unclickable. Same deferral as
     option-label.tsx's TimedOptionLabel; both updaters bail out when they agree. */
  useEffect(() => {
    const current = now();
    const clientToday = todayIsoFrom(current);
    const clientCursor = monthCursorFrom(current);
    setToday((serverToday) => (serverToday === clientToday ? serverToday : clientToday));
    setMonthCursor((serverCursor) => (
      serverCursor.year === clientCursor.year && serverCursor.monthIndex === clientCursor.monthIndex
        ? serverCursor
        : clientCursor
    ));
    // Runs once: only the hydration-time correction, never after the organizer navigates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [title, setTitle] = useState("");
  const [pickedDays, setPickedDays] = useState<ReadonlySet<string>>(() => new Set());
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [dayTimes, setDayTimes] = useState<ReadonlyMap<string, DayTime>>(() => new Map());
  const [combine, setCombine] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [ownerDisplayName, setOwnerDisplayName] = useState(defaultOwnerDisplayName);
  const [optionLimit, setOptionLimit] = useState("10");
  const [coOrganizerEmail, setCoOrganizerEmail] = useState("");
  const [coOrganizerEmails, setCoOrganizerEmails] = useState<string[]>([]);
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [optionsError, setOptionsError] = useState<string | undefined>(undefined);
  const [advancedErrors, setAdvancedErrors] = useState<AdvancedErrors>({});
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [invalidDays, setInvalidDays] = useState<ReadonlySet<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreateAppointmentSuccess | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("IDLE");
  const submitLock = useRef(false);
  const lastSubmission = useRef<LastSubmission | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const endTimeRef = useRef<HTMLInputElement>(null);

  /*
   * Adopt anything typed before hydration. These three fields are server-rendered
   * and the title is autoFocused, so on a slow connection a person starts typing
   * into a field React has not attached to yet — no change event is ever raised and
   * the value stays out of state. Creation would then fail with "Add a title."
   * while the title sits visibly in the box. Everything else in this form is behind
   * the More-settings disclosure, which cannot open until React is running.
   */
  useEffect(() => {
    const adopted: [HTMLInputElement | null, (value: string) => void][] = [
      [titleRef.current, setTitle],
      [startTimeRef.current, setStartTime],
      [endTimeRef.current, setEndTime],
    ];
    for (const [element, setValue] of adopted) {
      if (element && element.value !== "") setValue(element.value);
    }
  }, []);

  const sortedDays = [...pickedDays].sort();
  const isRun = isConsecutiveRun(sortedDays);
  const effectiveRange = isRun && combine;
  const showChipTimes = startTime !== "" && !effectiveRange;
  const atCoOrganizerLimit = coOrganizerEmails.length >= COORGANIZER_MAX_COUNT;
  const inferredType: AppointmentType = effectiveRange
    ? (startTime === "" ? "DATE_RANGE" : "DATE_TIME_RANGE")
    : startTime === ""
      ? "DATE"
      : endTime === "" ? "DATE_TIME" : "DATE_TIME_RANGE";
  const badgeWords = inferredType === "DATE_TIME_RANGE" && !effectiveRange
    ? SAME_DAY_SPAN_WORDS
    : TYPE_WORDS[inferredType];
  const formDescribedBy = [
    optionsError ? "composer-options-error" : null,
    submitError ? "composer-submit-error" : null,
  ].filter((id): id is string => id !== null).join(" ") || undefined;

  function startFor(day: string): string {
    return dayTimes.get(day)?.start ?? startTime;
  }

  function endFor(day: string): string {
    return dayTimes.get(day)?.end ?? endTime;
  }

  /** A per-day override is exactly where an impossible span gets typed, so the
      chip says so as it happens; createAppointment keeps the same guard. */
  function hasInvalidSpan(day: string): boolean {
    return endFor(day) <= startFor(day);
  }

  const spanInvalidDays = new Set(
    inferredType === "DATE_TIME_RANGE" && !effectiveRange
      ? sortedDays.filter(hasInvalidSpan)
      : [],
  );

  /* The normative inference: a run of days only collapses into a range once the
     organizer opts in, so "Monday or Tuesday?" stays the default reading. */
  function buildOptions(days: readonly string[]): BuiltOptions {
    const labels = days.map((day) => formatCalendarDate(day));
    const perDay = days.map((day) => [day]);

    if (effectiveRange) {
      const first = days[0];
      const last = days[days.length - 1];
      const rangeLabel = [`${formatCalendarDate(first)} to ${formatCalendarDate(last)}`];
      const rangeDays = [[...days]];
      if (startTime === "") {
        return {
          type: "DATE_RANGE",
          options: [{ kind: "DATE_RANGE", startDate: first, endDate: last }],
          optionLabels: rangeLabel,
          optionDays: rangeDays,
        };
      }
      return {
        type: "DATE_TIME_RANGE",
        options: [{
          kind: "DATE_TIME_RANGE",
          startAt: localTimeToUtc(`${first}T${startTime}`),
          endAt: localTimeToUtc(`${last}T${endTime === "" ? startTime : endTime}`),
        }],
        optionLabels: rangeLabel,
        optionDays: rangeDays,
      };
    }

    if (startTime === "") {
      return {
        type: "DATE",
        options: days.map((day) => ({ kind: "DATE", startDate: day })),
        optionLabels: labels,
        optionDays: perDay,
      };
    }

    if (endTime === "") {
      return {
        type: "DATE_TIME",
        options: days.map((day) => ({
          kind: "DATE_TIME",
          startAt: localTimeToUtc(`${day}T${startFor(day)}`),
        })),
        optionLabels: labels,
        optionDays: perDay,
      };
    }

    return {
      type: "DATE_TIME_RANGE",
      options: days.map((day) => {
        if (hasInvalidSpan(day)) throw new Error("End time must be after start time.");
        return {
          kind: "DATE_TIME_RANGE",
          startAt: localTimeToUtc(`${day}T${startFor(day)}`),
          endAt: localTimeToUtc(`${day}T${endFor(day)}`),
        };
      }),
      optionLabels: labels,
      optionDays: perDay,
    };
  }

  function clearCompositionErrors(): void {
    setOptionsError(undefined);
    setSubmitError(undefined);
    setInvalidDays((current) => (current.size === 0 ? current : new Set()));
  }

  function toggleDay(day: string, picked: boolean): void {
    const next = new Set(pickedDays);
    if (picked) next.add(day);
    else next.delete(day);
    setPickedDays(next);
    if (!isConsecutiveRun([...next].sort())) setCombine(false);
    if (!picked) {
      setDayTimes((current) => {
        if (!current.has(day)) return current;
        const remaining = new Map(current);
        remaining.delete(day);
        return remaining;
      });
    }
    clearCompositionErrors();
  }

  function stepMonth(delta: -1 | 1): void {
    setMonthCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.monthIndex + delta, 1));
      return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() };
    });
  }

  function updateStartTime(value: string): void {
    setStartTime(value);
    if (value === "") {
      setEndTime("");
      setDayTimes(new Map());
    }
    clearCompositionErrors();
  }

  function updateDayTime(day: string, field: "start" | "end", value: string): void {
    setDayTimes((current) => {
      const next = new Map(current);
      const updated: DayTime = { ...next.get(day), [field]: value === "" ? undefined : value };
      if (updated.start === undefined && updated.end === undefined) next.delete(day);
      else next.set(day, updated);
      return next;
    });
    clearCompositionErrors();
  }

  function updateAdvanced(field: AdvancedField, apply: () => void): void {
    apply();
    setAdvancedErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError(undefined);
  }

  function addCoOrganizer(): void {
    if (atCoOrganizerLimit) return;
    let email: string;
    try {
      email = normalizeEmail(coOrganizerEmail);
    } catch {
      setAdvancedErrors((current) => ({ ...current, coOrganizerEmail: "Enter one valid Google email address." }));
      return;
    }
    if (coOrganizerEmails.includes(email)) {
      setAdvancedErrors((current) => ({ ...current, coOrganizerEmail: "This co-organizer has already been added." }));
      return;
    }
    setCoOrganizerEmail("");
    setCoOrganizerEmails([...coOrganizerEmails, email]);
    setAdvancedErrors((current) => ({ ...current, coOrganizerEmail: undefined, coOrganizerEmails: undefined }));
  }

  function removeCoOrganizer(email: string): void {
    setCoOrganizerEmails(coOrganizerEmails.filter((current) => current !== email));
    setAdvancedErrors((current) => ({ ...current, coOrganizerEmails: undefined }));
  }

  /* The route flattens its keys, but the service reports dotted ones such as
     options.0.startDate. Splitting on "." is what routes a real option problem
     back to the day that caused it instead of the generic banner. */
  function applyApiFieldErrors(fieldErrors: Record<string, string[]>): boolean {
    const submission = lastSubmission.current;
    const nextAdvanced: AdvancedErrors = {};
    const nextInvalidDays = new Set<string>();
    let nextTitleError: string | undefined;
    let nextOptionsError: string | undefined;
    let openAdvanced = false;
    let mapped = false;

    for (const [key, messages] of Object.entries(fieldErrors)) {
      const message = messages[0];
      if (message === undefined) continue;
      const [field, ...rest] = key.split(".");

      if (field === "title") {
        nextTitleError ??= message;
        mapped = true;
      } else if (field === "description" || field === "ownerDisplayName" || field === "optionLimit") {
        nextAdvanced[field] ??= message;
        openAdvanced = true;
        mapped = true;
      } else if (field === "coOrganizerEmails") {
        const index = rest.length > 0 ? Number(rest[0]) : Number.NaN;
        const email = Number.isInteger(index) ? submission?.input.coOrganizerEmails[index] : undefined;
        nextAdvanced.coOrganizerEmails ??= email === undefined ? message : `${email}: ${message}`;
        openAdvanced = true;
        mapped = true;
      } else if (field === "type" || field === "timeZone") {
        nextOptionsError ??= message;
        mapped = true;
      } else if (field === "options") {
        const index = rest.length > 0 ? Number(rest[0]) : Number.NaN;
        const label = Number.isInteger(index) ? submission?.optionLabels[index] : undefined;
        nextOptionsError ??= label === undefined ? message : `${label}: ${message}`;
        if (Number.isInteger(index)) {
          for (const day of submission?.optionDays[index] ?? []) nextInvalidDays.add(day);
        }
        mapped = true;
      }
    }

    setTitleError(nextTitleError);
    setOptionsError(nextOptionsError);
    setAdvancedErrors(nextAdvanced);
    setInvalidDays(nextInvalidDays);
    if (openAdvanced) setAdvancedOpen(true);
    return mapped;
  }

  async function createAppointment(): Promise<void> {
    if (submitLock.current) return;

    const trimmedTitle = title.trim();
    const days = sortedDays;
    const nextAdvanced: AdvancedErrors = {};
    let nextTitleError: string | undefined;
    let nextOptionsError: string | undefined;

    if (!trimmedTitle) nextTitleError = "Add a title.";
    else if (!isValidTitleLength(trimmedTitle)) {
      nextTitleError = `Keep the title to ${TITLE_MAX_LENGTH} characters or fewer.`;
    }

    let built: BuiltOptions | null = null;
    if (days.length === 0) nextOptionsError = "Pick at least one day.";
    else {
      try {
        built = buildOptions(days);
      } catch (error) {
        nextOptionsError = error instanceof Error ? error.message : "Check the picked days and times.";
      }
    }

    if (!isValidDescriptionLength(description)) {
      nextAdvanced.description = `Keep the description to ${DESCRIPTION_MAX_LENGTH} characters or fewer.`;
    }

    const parsedLimit = Number(optionLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < OPTION_LIMIT_MIN || parsedLimit > OPTION_LIMIT_MAX) {
      nextAdvanced.optionLimit = `Enter a whole number from ${OPTION_LIMIT_MIN} to ${OPTION_LIMIT_MAX}.`;
    } else if (built !== null && built.options.length > parsedLimit) {
      nextAdvanced.optionLimit = `Use an option limit of at least ${built.options.length}, or remove days.`;
    }

    const ownerName = normalizeParticipantName(ownerDisplayName).displayName;
    if (!isValidDisplayNameLength(ownerName)) {
      nextAdvanced.ownerDisplayName = `Enter an owner display name of ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
    }

    let pendingEmail: string | null = null;
    if (coOrganizerEmail.trim()) {
      try {
        pendingEmail = normalizeEmail(coOrganizerEmail);
      } catch {
        nextAdvanced.coOrganizerEmail = "Enter one valid Google email address.";
      }
      if (pendingEmail !== null && coOrganizerEmails.includes(pendingEmail)) {
        nextAdvanced.coOrganizerEmail = "This co-organizer has already been added.";
        pendingEmail = null;
      }
    }

    const hasAdvancedError = Object.keys(nextAdvanced).length > 0;
    if (nextTitleError !== undefined || nextOptionsError !== undefined || hasAdvancedError || built === null) {
      setTitleError(nextTitleError);
      setOptionsError(nextOptionsError);
      setAdvancedErrors(nextAdvanced);
      setSubmitError(undefined);
      if (hasAdvancedError) setAdvancedOpen(true);
      return;
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) {
      setTitleError(undefined);
      setOptionsError(undefined);
      setAdvancedErrors({});
      setSubmitError("Your browser did not provide a time zone. Check its date and time settings, then try again.");
      return;
    }

    const emails = pendingEmail === null ? [...coOrganizerEmails] : [...coOrganizerEmails, pendingEmail];
    if (pendingEmail !== null) {
      setCoOrganizerEmail("");
      setCoOrganizerEmails(emails);
    }

    const input: CreateAppointmentInput = {
      title: trimmedTitle,
      description: description.trim() || null,
      ownerDisplayName: ownerName,
      type: built.type,
      optionLimit: parsedLimit,
      coOrganizerEmails: emails,
      timeZone,
      options: built.options,
    };
    lastSubmission.current = {
      input,
      optionLabels: built.optionLabels,
      optionDays: built.optionDays,
    };

    submitLock.current = true;
    setSubmitting(true);
    setTitleError(undefined);
    setOptionsError(undefined);
    setAdvancedErrors({});
    setSubmitError(undefined);
    setInvalidDays(new Set());

    let result: CreateAppointmentSuccess;
    try {
      result = await submit(input);
    } catch (error) {
      submitLock.current = false;
      setSubmitting(false);
      if (error instanceof CreateAppointmentRequestError) {
        if (error.fieldErrors && applyApiFieldErrors(error.fieldErrors)) setSubmitError(undefined);
        else setSubmitError(error.message);
      } else {
        setSubmitError("The appointment could not be created. Check your connection and try again.");
      }
      return;
    }

    submitLock.current = false;
    setSubmitting(false);
    setCreated(result);
    setTitle("");
    setPickedDays(new Set());
    setDayTimes(new Map());
    setStartTime("");
    setEndTime("");
    setCombine(false);
    setInvalidDays(new Set());
    await runCopy(result.publicUrl);
    router.refresh();
  }

  /* Copying is best effort: an owner context without clipboard permission must
     still land on a created appointment. */
  async function runCopy(publicUrl: string): Promise<void> {
    setCopyState("COPYING");
    try {
      await copyText(publicUrl);
      setCopyState("COPIED");
    } catch {
      setCopyState("FAILED");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void createAppointment();
  }

  function copyPublicLink(): void {
    if (created === null || copyState === "COPYING") return;
    void runCopy(created.publicUrl);
  }

  return (
    <div className={styles.composerRegion}>
      <form
        aria-describedby={formDescribedBy}
        className={styles.composer}
        onSubmit={handleSubmit}
        noValidate
      >
        <label className={styles.visuallyHidden} htmlFor="composer-title">Title</label>
        <input
          className={styles.composerTitleInput}
          id="composer-title"
          ref={titleRef}
          autoFocus
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setTitleError(undefined);
            setSubmitError(undefined);
          }}
          maxLength={TITLE_MAX_LENGTH}
          placeholder="What are you scheduling?"
          disabled={submitting}
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? "composer-title-error" : undefined}
        />
        {titleError && <p className={styles.fieldError} id="composer-title-error" role="alert">{titleError}</p>}

        <div className={styles.composerLayout}>
          <MonthGrid
            month={monthCursor}
            selectedDays={pickedDays}
            today={today}
            onToggleDay={toggleDay}
            onStepMonth={stepMonth}
            disabled={submitting}
          />

          <div className={styles.composerSide}>
            <div className={styles.timeRow}>
              <div className={styles.field}>
                <label htmlFor="composer-start-time">Start time</label>
                <input
                  id="composer-start-time"
                  ref={startTimeRef}
                  type="time"
                  value={startTime}
                  onChange={(event) => updateStartTime(event.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="composer-end-time">End time</label>
                <input
                  id="composer-end-time"
                  ref={endTimeRef}
                  type="time"
                  value={endTime}
                  onChange={(event) => {
                    setEndTime(event.target.value);
                    clearCompositionErrors();
                  }}
                  disabled={submitting || startTime === ""}
                />
              </div>
              {isRun && (
                <div className={styles.combineField}>
                  <input
                    id="composer-combine"
                    type="checkbox"
                    checked={combine}
                    onChange={(event) => {
                      setCombine(event.target.checked);
                      clearCompositionErrors();
                    }}
                    disabled={submitting}
                  />
                  <label htmlFor="composer-combine">Combine into one date range</label>
                </div>
              )}
            </div>

            {optionsError && <p className={styles.fieldError} id="composer-options-error" role="alert">{optionsError}</p>}

            <div className={styles.typeStatus}>
              <span className={styles.typeStatusLabel}>Creates</span>
              <p className={styles.typeBadge} data-inferred-type={inferredType} aria-live="polite">
                {badgeWords}
              </p>
            </div>

            {sortedDays.length === 0 ? (
              <p className={styles.fieldHint}>Click the days that could work.</p>
            ) : (
              <ul className={styles.chipList} aria-label="Selected days">
                {sortedDays.map((day) => {
                  const label = formatCalendarDate(day);
                  const start = startFor(day);
                  const end = endFor(day);
                  const edited = showChipTimes && dayTimes.has(day);
                  const spanInvalid = spanInvalidDays.has(day);
                  /* A combined run has one start and one end, carried by the shared
                     fields; per-day times are not part of that payload, so showing
                     them on the chips would name times nothing will be created at. */
                  const suffix = effectiveRange || startTime === ""
                    ? ""
                    : ` · ${start}${endTime === "" ? "" : `–${end}`}`;

                  return (
                    <li
                      className={styles.chip}
                      key={day}
                      data-invalid={spanInvalid || invalidDays.has(day) ? "true" : undefined}
                      data-edited={edited ? "true" : undefined}
                    >
                      <span className={styles.chipDate}>{label}{suffix}</span>
                      {edited && <span className={styles.countStatus}>edited</span>}
                      {showChipTimes && (
                        <span className={styles.chipTime}>
                          <label className={styles.visuallyHidden} htmlFor={`composer-chip-start-${day}`}>
                            Start time for {label}
                          </label>
                          <input
                            id={`composer-chip-start-${day}`}
                            type="time"
                            value={start}
                            onChange={(event) => updateDayTime(day, "start", event.target.value)}
                            disabled={submitting}
                            aria-invalid={spanInvalid}
                            aria-describedby={spanInvalid ? `composer-chip-error-${day}` : undefined}
                          />
                          {endTime !== "" && (
                            <>
                              <label className={styles.visuallyHidden} htmlFor={`composer-chip-end-${day}`}>
                                End time for {label}
                              </label>
                              <input
                                id={`composer-chip-end-${day}`}
                                type="time"
                                value={end}
                                onChange={(event) => updateDayTime(day, "end", event.target.value)}
                                disabled={submitting}
                                aria-invalid={spanInvalid}
                                aria-describedby={spanInvalid ? `composer-chip-error-${day}` : undefined}
                              />
                            </>
                          )}
                        </span>
                      )}
                      {spanInvalid && (
                        <span className={styles.chipError} id={`composer-chip-error-${day}`}>
                          End time must be after start time.
                        </span>
                      )}
                      <button
                        className={styles.chipRemove}
                        type="button"
                        onClick={() => toggleDay(day, false)}
                        aria-label={`Remove ${label}`}
                        disabled={submitting}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className={styles.composerActions}>
              <button className={styles.primaryButton} type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create and copy link"}
              </button>
              <button
                aria-controls="composer-advanced"
                aria-expanded={advancedOpen}
                className={styles.disclosureToggle}
                type="button"
                onClick={() => setAdvancedOpen(!advancedOpen)}
                disabled={submitting}
              >
                More settings
              </button>
            </div>

            {submitError && <p className={styles.formError} id="composer-submit-error" role="alert">{submitError}</p>}

            {advancedOpen && (
              <div className={styles.advancedPanel} id="composer-advanced">
                <div className={styles.field}>
                  <label htmlFor="composer-description">Description (optional)</label>
                  <textarea
                    id="composer-description"
                    value={description}
                    onChange={(event) => updateAdvanced("description", () => setDescription(event.target.value))}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    rows={4}
                    disabled={submitting}
                    aria-invalid={Boolean(advancedErrors.description)}
                    aria-describedby={advancedErrors.description ? "composer-description-error" : undefined}
                  />
                  {advancedErrors.description && (
                    <p className={styles.fieldError} id="composer-description-error" role="alert">
                      {advancedErrors.description}
                    </p>
                  )}
                </div>

                <div className={styles.field}>
                  <label htmlFor="composer-owner-display-name">Owner display name</label>
                  <input
                    id="composer-owner-display-name"
                    value={ownerDisplayName}
                    onChange={(event) => updateAdvanced("ownerDisplayName", () => setOwnerDisplayName(event.target.value))}
                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                    disabled={submitting}
                    aria-invalid={Boolean(advancedErrors.ownerDisplayName)}
                    aria-describedby={advancedErrors.ownerDisplayName ? "composer-owner-display-name-error" : undefined}
                  />
                  {advancedErrors.ownerDisplayName && (
                    <p className={styles.fieldError} id="composer-owner-display-name-error" role="alert">
                      {advancedErrors.ownerDisplayName}
                    </p>
                  )}
                </div>

                <div className={styles.field}>
                  <label htmlFor="composer-option-limit">Option limit</label>
                  <input
                    id="composer-option-limit"
                    type="number"
                    inputMode="numeric"
                    min={OPTION_LIMIT_MIN}
                    max={OPTION_LIMIT_MAX}
                    step="1"
                    value={optionLimit}
                    onChange={(event) => updateAdvanced("optionLimit", () => setOptionLimit(event.target.value))}
                    disabled={submitting}
                    aria-invalid={Boolean(advancedErrors.optionLimit)}
                    aria-describedby={advancedErrors.optionLimit ? "composer-option-limit-error" : undefined}
                  />
                  {advancedErrors.optionLimit && (
                    <p className={styles.fieldError} id="composer-option-limit-error" role="alert">
                      {advancedErrors.optionLimit}
                    </p>
                  )}
                </div>

                <div className={styles.inlineField}>
                  <div className={styles.field}>
                    <label htmlFor="composer-co-organizer-email">Co-organizer email</label>
                    <input
                      id="composer-co-organizer-email"
                      type="email"
                      value={coOrganizerEmail}
                      onChange={(event) => updateAdvanced("coOrganizerEmail", () => setCoOrganizerEmail(event.target.value))}
                      disabled={submitting || atCoOrganizerLimit}
                      aria-invalid={Boolean(advancedErrors.coOrganizerEmail)}
                      /* The list-level error names this same control, so it is
                         announced here too rather than being orphaned. */
                      aria-describedby={[
                        advancedErrors.coOrganizerEmail ? "composer-co-organizer-email-error" : "",
                        advancedErrors.coOrganizerEmails ? "composer-co-organizers-error" : "",
                      ].filter(Boolean).join(" ") || undefined}
                    />
                    {advancedErrors.coOrganizerEmail && (
                      <p className={styles.fieldError} id="composer-co-organizer-email-error" role="alert">
                        {advancedErrors.coOrganizerEmail}
                      </p>
                    )}
                  </div>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={addCoOrganizer}
                    disabled={submitting || atCoOrganizerLimit}
                  >
                    Add co-organizer
                  </button>
                </div>

                <p className={styles.countStatus}>
                  {coOrganizerEmails.length} of {COORGANIZER_MAX_COUNT} co-organizers added
                </p>
                {advancedErrors.coOrganizerEmails && (
                  <p className={styles.fieldError} id="composer-co-organizers-error" role="alert">
                    {advancedErrors.coOrganizerEmails}
                  </p>
                )}
                {coOrganizerEmails.length > 0 && (
                  <ul className={styles.compactLedger} aria-label="Co-organizers">
                    {coOrganizerEmails.map((email) => (
                      <li key={email}>
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => removeCoOrganizer(email)}
                          aria-label={`Remove co-organizer ${email}`}
                          disabled={submitting}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </form>

      {created && (
        <section className={styles.successPanel} aria-label="Appointment created">
          <div className={styles.shareLink}>
            <label htmlFor="public-appointment-link">Public appointment link</label>
            <input id="public-appointment-link" value={created.publicUrl} readOnly />
          </div>
          <div className={styles.composerActions}>
            <a className={styles.secondaryAction} href={created.publicUrl} target="_blank" rel="noreferrer">
              Open appointment
            </a>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={copyPublicLink}
              disabled={copyState === "COPYING"}
            >
              {copyState === "COPYING" ? "Copying…" : "Copy link"}
            </button>
          </div>
          {copyState === "COPIED" && <p className={styles.copyStatus} role="status">Link copied.</p>}
          {copyState === "FAILED" && (
            <p className={styles.formError} role="alert">Copy failed. Select the link above and copy it manually.</p>
          )}
        </section>
      )}
    </div>
  );
}
