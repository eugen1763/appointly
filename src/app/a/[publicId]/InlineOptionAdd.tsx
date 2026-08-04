"use client";

import { useRef, useState, type FormEvent } from "react";

import {
  addOptionSuccessSchema,
  type AddOptionRequest,
  type OptionInput,
} from "../../../features/appointments/contracts";
import { localTimeToUtc } from "../../../features/appointments/local-date-time";
import {
  MonthGrid,
  isoDate,
  type MonthCursor,
} from "../../../features/appointments/MonthGrid";
import routeStyles from "../../routes.module.css";
import { routeErrorMessage } from "./appointment-patch";
import styles from "./appointment.module.css";
import { formatCalendarDate } from "./calendar-date";

const INVALID_SUCCESS_MESSAGE = "The server returned an invalid suggestion response. Try again.";
const GENERIC_ERROR_MESSAGE = "Could not add the suggestion. Try again.";

export interface InlineOptionAddProps {
  readonly publicId: string;
  readonly participantId: string;
  readonly appointmentType: OptionInput["kind"];
  readonly onAdded: () => void | Promise<void>;
  /** Test seam; the calendar is only ever rendered in the browser. */
  readonly now?: () => Date;
}

function todayIsoFrom(current: Date): string {
  return isoDate(current.getFullYear(), current.getMonth(), current.getDate());
}

function monthCursorFrom(current: Date): MonthCursor {
  return { year: current.getFullYear(), monthIndex: current.getMonth() };
}

function inclusiveRun(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(
    Number(startDay.slice(0, 4)),
    Number(startDay.slice(5, 7)) - 1,
    Number(startDay.slice(8, 10)),
  ));
  for (let step = 0; step < 400; step += 1) {
    const day = isoDate(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate());
    days.push(day);
    if (day >= endDay) return days;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function InlineOptionAdd({
  publicId,
  participantId,
  appointmentType,
  onAdded,
  now = () => new Date(),
}: InlineOptionAddProps) {
  const [open, setOpen] = useState(false);
  const [startDay, setStartDay] = useState("");
  const [endDay, setEndDay] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [cursor, setCursor] = useState<MonthCursor>(() => monthCursorFrom(now()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [todayIso] = useState(() => todayIsoFrom(now()));
  const submitLock = useRef(false);

  const isRange = appointmentType === "DATE_RANGE" || appointmentType === "DATE_TIME_RANGE";
  const isTimed = appointmentType === "DATE_TIME" || appointmentType === "DATE_TIME_RANGE";
  const selectedDays = new Set(
    appointmentType === "DATE" || startDay === ""
      ? []
      : isRange
        ? inclusiveRun(startDay, endDay === "" ? startDay : endDay)
        : [startDay],
  );

  async function addOption(buildOption: () => OptionInput): Promise<void> {
    if (submitLock.current) return;

    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const request: AddOptionRequest = {
        participantId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        option: buildOption(),
      };
      const response = await fetch(`/api/appointments/${publicId}/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error(response.ok ? INVALID_SUCCESS_MESSAGE : GENERIC_ERROR_MESSAGE);
      }
      if (!response.ok) throw new Error(routeErrorMessage(body, GENERIC_ERROR_MESSAGE));
      const parsed = addOptionSuccessSchema.safeParse(body);
      if (!parsed.success) throw new Error(INVALID_SUCCESS_MESSAGE);

      await onAdded();
      setStartDay("");
      setEndDay("");
      setStartTime("");
      setEndTime("");
      setStatus("Suggestion added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : GENERIC_ERROR_MESSAGE);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function optionFromPicks(): OptionInput {
    switch (appointmentType) {
      case "DATE":
        // Unreachable: a day appointment posts straight from the day click.
        return { kind: appointmentType, startDate: startDay };
      case "DATE_TIME":
        return { kind: appointmentType, startAt: localTimeToUtc(`${startDay}T${startTime}`) };
      case "DATE_RANGE":
        if (startDay === "" || endDay === "") {
          throw new Error("Choose a start and end date.");
        }
        return { kind: appointmentType, startDate: startDay, endDate: endDay };
      case "DATE_TIME_RANGE":
        if (startDay === "" || endDay === "") {
          throw new Error("Choose a start and end date.");
        }
        return {
          kind: appointmentType,
          startAt: localTimeToUtc(`${startDay}T${startTime}`),
          endAt: localTimeToUtc(`${endDay}T${endTime}`),
        };
    }
  }

  function toggleDay(day: string): void {
    // A day appointment needs nothing else, so one click is the whole suggestion.
    // The confirmation below always announces the write it just made.
    if (appointmentType === "DATE") {
      void addOption(() => ({ kind: "DATE", startDate: day }));
      return;
    }
    setError(null);
    setStatus(null);
    if (!isRange) {
      setStartDay((current) => (current === day ? "" : day));
      return;
    }
    if (startDay === "" || endDay !== "" || day < startDay) {
      setStartDay(day);
      setEndDay("");
      return;
    }
    setEndDay(day);
  }

  function stepMonth(delta: -1 | 1): void {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.monthIndex + delta, 1));
      return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() };
    });
  }

  function summaryText(): string {
    if (appointmentType === "DATE") return "Click a day to add it as an option.";
    if (startDay === "") return isRange ? "Pick a start and end day." : "Pick a day.";
    if (!isRange) return formatCalendarDate(startDay);
    return endDay === ""
      ? `${formatCalendarDate(startDay)} – pick an end day.`
      : `${formatCalendarDate(startDay)} – ${formatCalendarDate(endDay)}`;
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void addOption(optionFromPicks);
  }

  return (
    <div className={styles.addOption}>
      <button
        type="button"
        className={styles.addOptionToggle}
        aria-controls="add-option-panel"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ＋ Add an option
      </button>
      {open ? (
        <div className={styles.addOptionPanel} id="add-option-panel">
          <form
            aria-busy={submitting}
            aria-describedby={error ? "suggestion-error" : status ? "suggestion-status" : undefined}
            aria-label="Suggest an option"
            onSubmit={submit}
          >
            <fieldset disabled={submitting}>
              <legend className={routeStyles.visuallyHidden}>Suggestion details</legend>
              <MonthGrid
                month={cursor}
                selectedDays={selectedDays}
                today={todayIso}
                onToggleDay={toggleDay}
                onStepMonth={stepMonth}
              />
              <p className={styles.addOptionSummary} data-picked-days>{summaryText()}</p>
              {isTimed ? (
                <div className={routeStyles.timeRow}>
                  <div className={routeStyles.field}>
                    <label htmlFor={appointmentType === "DATE_TIME" ? "suggestion-time" : "suggestion-start-time"}>
                      {appointmentType === "DATE_TIME" ? "Time" : "Start time"}
                    </label>
                    <input
                      id={appointmentType === "DATE_TIME" ? "suggestion-time" : "suggestion-start-time"}
                      type="time"
                      required
                      value={startTime}
                      onChange={(event) => setStartTime(event.currentTarget.value)}
                    />
                  </div>
                  {appointmentType === "DATE_TIME_RANGE" ? (
                    <div className={routeStyles.field}>
                      <label htmlFor="suggestion-end-time">End time</label>
                      <input
                        id="suggestion-end-time"
                        type="time"
                        required
                        value={endTime}
                        onChange={(event) => setEndTime(event.currentTarget.value)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {appointmentType === "DATE" ? null : (
                <button type="submit">{submitting ? "Adding suggestion…" : "Suggest option"}</button>
              )}
            </fieldset>
            {error ? (
              <p className={styles.suggestionError} id="suggestion-error" role="alert">{error}</p>
            ) : null}
            {status ? (
              <p className={styles.suggestionStatus} id="suggestion-status" role="status">{status}</p>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
