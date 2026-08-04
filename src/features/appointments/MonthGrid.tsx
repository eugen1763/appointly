"use client";

import { formatCalendarDate } from "../../app/a/[publicId]/calendar-date";
import styles from "../../app/routes.module.css";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface MonthCursor {
  readonly year: number;
  readonly monthIndex: number;
}

export interface MonthGridProps {
  readonly month: MonthCursor;
  readonly selectedDays: ReadonlySet<string>;
  readonly today: string;
  readonly onToggleDay: (isoDate: string, picked: boolean) => void;
  readonly onStepMonth: (delta: -1 | 1) => void;
  readonly disabled?: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Built by hand from UTC parts: toISOString on a local Date shifts the calendar day. */
export function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

function firstWeekdayOf(month: MonthCursor): number {
  return new Date(Date.UTC(month.year, month.monthIndex, 1)).getUTCDay();
}

function dayCountOf(month: MonthCursor): number {
  return new Date(Date.UTC(month.year, month.monthIndex + 1, 0)).getUTCDate();
}

export function MonthGrid({
  month,
  selectedDays,
  today,
  onToggleDay,
  onStepMonth,
  disabled = false,
}: MonthGridProps) {
  const leadingBlanks = firstWeekdayOf(month);
  const dayCount = dayCountOf(month);

  return (
    <div className={styles.calendar}>
      <div className={styles.calendarHead}>
        <button
          className={styles.calendarStep}
          type="button"
          onClick={() => onStepMonth(-1)}
          aria-label="Previous month"
          disabled={disabled}
        >
          ‹
        </button>
        <span className={styles.calendarMonth} data-cal-month aria-live="polite">
          {MONTH_NAMES[month.monthIndex]} {month.year}
        </span>
        <button
          className={styles.calendarStep}
          type="button"
          onClick={() => onStepMonth(1)}
          aria-label="Next month"
          disabled={disabled}
        >
          ›
        </button>
      </div>

      <div className={styles.calendarWeekdays}>
        {WEEKDAY_NAMES.map((weekday) => (
          <span aria-hidden="true" key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className={styles.calendarGrid}>
        {Array.from({ length: leadingBlanks }, (_unused, index) => (
          <span aria-hidden="true" key={`blank-${index}`} />
        ))}
        {Array.from({ length: dayCount }, (_unused, index) => {
          const day = index + 1;
          const iso = isoDate(month.year, month.monthIndex, day);
          const picked = selectedDays.has(iso);
          const weekday = (leadingBlanks + index) % 7;

          return (
            <button
              className={styles.dayButton}
              type="button"
              key={iso}
              data-date={iso}
              data-today={iso === today ? "1" : undefined}
              data-weekend={weekday === 0 || weekday === 6 ? "1" : undefined}
              aria-pressed={picked}
              aria-label={formatCalendarDate(iso)}
              disabled={disabled || iso < today}
              onClick={() => onToggleDay(iso, !picked)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
