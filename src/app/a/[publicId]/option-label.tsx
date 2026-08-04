"use client";

import { useEffect, useState } from "react";

import type { OptionValue } from "../../../features/appointments/contracts";
import styles from "./appointment.module.css";

type TimedOption = Extract<OptionValue, { kind: "DATE_TIME" | "DATE_TIME_RANGE" }>;

export interface FormattedTimedOption {
  readonly label: string;
  readonly timeZone: string;
}


export function formatTimedOption(
  option: TimedOption,
  locale?: string,
  timeZone?: string,
): FormattedTimedOption {
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });
  const start = formatter.format(option.startAt);
  return {
    label: option.kind === "DATE_TIME_RANGE"
      ? `${start} – ${formatter.format(option.endAt)}`
      : start,
    timeZone: formatter.resolvedOptions().timeZone,
  };
}

export function TimedOptionLabel({ option }: Readonly<{ option: TimedOption }>) {
  const [formatted, setFormatted] = useState<FormattedTimedOption | null>(null);

  useEffect(() => {
    setFormatted(formatTimedOption(option));
  }, [option]);

  if (!formatted) {
    // No aria-label here: it is prohibited on a generic span and never
    // exposed, and the visible text already names this placeholder.
    return (
      <span className={styles.timePending}>
        Local time
      </span>
    );
  }

  return (
    <span className={styles.timedLabel}>
      <time>{formatted.label}</time>
      <span className={styles.timeZone} data-time-zone>{formatted.timeZone}</span>
    </span>
  );
}
