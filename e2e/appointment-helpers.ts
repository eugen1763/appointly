import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { formatCalendarDate } from "../src/app/a/[publicId]/calendar-date";
import { appointmentSnapshotSchema } from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";

export type AppointmentCandidate =
  | { readonly kind: "DATE"; readonly startDate: string }
  | { readonly kind: "DATE_TIME"; readonly startAtLocal: string }
  | {
      readonly kind: "DATE_RANGE";
      readonly startDate: string;
      readonly endDate: string;
    }
  | {
      readonly kind: "DATE_TIME_RANGE";
      readonly startAtLocal: string;
      readonly endAtLocal: string;
    };

type CandidateFor<Kind extends AppointmentCandidate["kind"]> = Extract<
  AppointmentCandidate,
  { readonly kind: Kind }
>;

type CandidateList<Kind extends AppointmentCandidate["kind"]> = readonly [
  CandidateFor<Kind>,
  ...CandidateFor<Kind>[],
];

interface CreationDetails {
  readonly title: string;
  readonly optionLimit: number;
  readonly ownerDisplayName?: string;
  readonly coOrganizerEmails?: readonly string[];
}

export type AppointmentCreationInput = CreationDetails &
  (
    | { readonly type: "DATE"; readonly candidates: CandidateList<"DATE"> }
    | {
        readonly type: "DATE_TIME";
        readonly candidates: CandidateList<"DATE_TIME">;
      }
    | {
        readonly type: "DATE_RANGE";
        readonly candidates: CandidateList<"DATE_RANGE">;
      }
    | {
        readonly type: "DATE_TIME_RANGE";
        readonly candidates: CandidateList<"DATE_TIME_RANGE">;
      }
  );

export interface CreatedAppointment {
  readonly publicUrl: string;
  readonly publicId: string;
}

const PUBLIC_APPOINTMENT_URL_PATTERN =
  /^http:\/\/127\.0\.0\.1:3000\/a\/([A-Za-z0-9_-]{24})$/u;

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

const MAXIMUM_MONTH_STEPS = 240;

/**
 * The composer never asks for a type: it infers one from the picked days and
 * the times. Each requested type therefore becomes a set of gestures, and
 * anything the composer cannot express fails loudly here rather than silently
 * creating the wrong type.
 */
interface ComposerGestures {
  /** Every day to click, ascending. */
  readonly days: readonly string[];
  /** The shared HH:mm start applied to every picked day, when the type is timed. */
  readonly startTime?: string;
  /** The shared HH:mm end, when the type carries an end. */
  readonly endTime?: string;
  /** Per-day HH:mm overrides for days that differ from the shared value. */
  readonly dayTimes?: ReadonlyMap<string, { start?: string; end?: string }>;
  /** Whether `Combine into one date range` must be checked. */
  readonly combine: boolean;
}

function splitLocal(value: string, label: string): { day: string; time: string } {
  const [day, time] = value.split("T");
  if (day === undefined || time === undefined) {
    throw new Error(`${label} must be a local YYYY-MM-DDTHH:mm value, received: ${value}`);
  }
  return { day, time };
}

function inclusiveRun(startDate: string, endDate: string): string[] {
  if (startDate >= endDate) {
    throw new Error(
      `The composer expresses a date range only across two or more days, received: ${startDate} to ${endDate}`,
    );
  }
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(
      Number(startDate.slice(0, 4)),
      Number(startDate.slice(5, 7)) - 1,
      Number(startDate.slice(8, 10)),
    ),
  );
  for (let step = 0; step < 400; step += 1) {
    const iso = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    days.push(iso);
    if (iso === endDate) return days;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  throw new Error(`Date range ${startDate} to ${endDate} is too long for the composer helper`);
}

function sharedAndOverrides(
  entries: readonly { day: string; start: string; end?: string }[],
): Pick<ComposerGestures, "startTime" | "endTime" | "dayTimes"> {
  const first = entries[0];
  const dayTimes = new Map<string, { start?: string; end?: string }>();
  for (const entry of entries.slice(1)) {
    const override: { start?: string; end?: string } = {};
    if (entry.start !== first.start) override.start = entry.start;
    if (entry.end !== undefined && entry.end !== first.end) override.end = entry.end;
    if (override.start !== undefined || override.end !== undefined) {
      dayTimes.set(entry.day, override);
    }
  }
  return { startTime: first.start, endTime: first.end, dayTimes };
}

function gesturesFor(input: AppointmentCreationInput): ComposerGestures {
  switch (input.type) {
    case "DATE":
      return {
        days: input.candidates.map((candidate) => candidate.startDate),
        combine: false,
      };
    case "DATE_TIME": {
      const entries = input.candidates.map((candidate) => {
        const { day, time } = splitLocal(candidate.startAtLocal, "startAtLocal");
        return { day, start: time };
      });
      return {
        days: entries.map((entry) => entry.day),
        combine: false,
        ...sharedAndOverrides(entries),
      };
    }
    case "DATE_RANGE": {
      if (input.candidates.length !== 1) {
        throw new Error(
          `The composer creates exactly one DATE_RANGE option, received ${input.candidates.length} candidates`,
        );
      }
      const candidate = input.candidates[0];
      return {
        days: inclusiveRun(candidate.startDate, candidate.endDate),
        combine: true,
      };
    }
    case "DATE_TIME_RANGE": {
      const bounds = input.candidates.map((candidate) => ({
        start: splitLocal(candidate.startAtLocal, "startAtLocal"),
        end: splitLocal(candidate.endAtLocal, "endAtLocal"),
      }));
      const spansDays = bounds.some((bound) => bound.start.day !== bound.end.day);
      if (!spansDays) {
        const entries = bounds.map((bound) => ({
          day: bound.start.day,
          start: bound.start.time,
          end: bound.end.time,
        }));
        return {
          days: entries.map((entry) => entry.day),
          combine: false,
          ...sharedAndOverrides(entries),
        };
      }
      if (bounds.length !== 1) {
        throw new Error(
          `The composer creates exactly one multi-day DATE_TIME_RANGE option, received ${bounds.length} candidates`,
        );
      }
      const bound = bounds[0];
      return {
        days: inclusiveRun(bound.start.day, bound.end.day),
        startTime: bound.start.time,
        endTime: bound.end.time,
        combine: true,
      };
    }
  }
}

export async function openMonth(
  scope: Page | Locator,
  isoDay: string,
): Promise<void> {
  const targetLabel = `${MONTH_NAMES[Number(isoDay.slice(5, 7)) - 1]} ${isoDay.slice(0, 4)}`;
  const monthLabel = scope.locator("[data-cal-month]");
  const current = (await monthLabel.textContent())?.trim() ?? "";
  if (current === targetLabel) return;

  const [currentMonthName, currentYear] = current.split(" ");
  const currentIndex = MONTH_NAMES.indexOf(
    currentMonthName as (typeof MONTH_NAMES)[number],
  );
  if (currentIndex === -1 || Number.isNaN(Number(currentYear))) {
    throw new Error(`The composer month label was unreadable: "${current}"`);
  }

  const delta = (Number(isoDay.slice(0, 4)) * 12 + Number(isoDay.slice(5, 7)) - 1)
    - (Number(currentYear) * 12 + currentIndex);
  if (Math.abs(delta) > MAXIMUM_MONTH_STEPS) {
    throw new Error(
      `Reaching ${targetLabel} from ${current} needs ${Math.abs(delta)} month steps, over the ${MAXIMUM_MONTH_STEPS} cap`,
    );
  }

  const step = scope.getByRole("button", {
    name: delta > 0 ? "Next month" : "Previous month",
    exact: true,
  });
  for (let pressed = 0; pressed < Math.abs(delta); pressed += 1) {
    await step.click();
  }
  await expect(monthLabel).toHaveText(targetLabel);
}

async function pickDays(page: Page, days: readonly string[]): Promise<void> {
  for (const day of [...days].sort()) {
    await openMonth(page, day);
    const dayButton = page.locator(`[data-date="${day}"]`);
    await dayButton.click();
    await expect(dayButton).toHaveAttribute("aria-pressed", "true");
  }
}

export async function createAppointmentThroughWizard(
  page: Page,
  input: AppointmentCreationInput,
): Promise<CreatedAppointment> {
  const gestures = gesturesFor(input);

  await page.goto("/appointments/new");

  await page.getByLabel("Title", { exact: true }).fill(input.title);

  await page
    .getByRole("button", { name: "More settings", exact: true })
    .click();
  await page
    .getByLabel("Option limit", { exact: true })
    .fill(String(input.optionLimit));
  if (input.ownerDisplayName !== undefined) {
    await page
      .getByLabel("Owner display name", { exact: true })
      .fill(input.ownerDisplayName);
  }
  for (const email of input.coOrganizerEmails ?? []) {
    await page.getByLabel("Co-organizer email", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Add co-organizer", exact: true })
      .click();
  }

  await pickDays(page, gestures.days);

  if (gestures.combine) {
    await page
      .getByLabel("Combine into one date range", { exact: true })
      .check();
  }

  if (gestures.startTime !== undefined) {
    await page
      .getByLabel("Start time", { exact: true })
      .fill(gestures.startTime);
  }
  if (gestures.endTime !== undefined) {
    await page.getByLabel("End time", { exact: true }).fill(gestures.endTime);
  }
  for (const [day, override] of gestures.dayTimes ?? []) {
    if (override.start !== undefined) {
      await page
        .getByLabel(`Start time for ${formatCalendarDate(day)}`, { exact: true })
        .fill(override.start);
    }
    if (override.end !== undefined) {
      await page
        .getByLabel(`End time for ${formatCalendarDate(day)}`, { exact: true })
        .fill(override.end);
    }
  }

  await expect(page.locator("[data-inferred-type]")).toHaveAttribute(
    "data-inferred-type",
    input.type,
  );

  await page
    .getByRole("button", { name: "Create and copy link", exact: true })
    .click();

  const publicLink = page.getByLabel("Public appointment link", {
    exact: true,
  });
  await expect(publicLink).toBeVisible();
  await expect(publicLink).toHaveAttribute("readonly", "");

  const publicUrl = await publicLink.inputValue();
  const match = PUBLIC_APPOINTMENT_URL_PATTERN.exec(publicUrl);
  expect(match, "creation returned a valid public appointment URL").not.toBeNull();
  if (!match) {
    throw new Error(`Invalid public appointment URL: ${publicUrl}`);
  }

  return { publicUrl, publicId: match[1] };
}

/** The keyboard budget for a complete guest response flow. */
export const MAXIMUM_TAB_PRESSES = 80;

export async function tabTo(
  page: Page,
  target: Locator,
  targetName: string,
  direction: "forward" | "backward" = "forward",
): Promise<void> {
  await expect(target, `${targetName} is visible before keyboard navigation`).toBeVisible();
  const key = direction === "forward" ? "Tab" : "Shift+Tab";
  for (let pressCount = 0; pressCount <= MAXIMUM_TAB_PRESSES; pressCount += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    if (pressCount < MAXIMUM_TAB_PRESSES) await page.keyboard.press(key);
  }
  throw new Error(
    `Keyboard navigation did not reach ${targetName} within ${MAXIMUM_TAB_PRESSES} ${key} presses`,
  );
}

/**
 * The segmented radio is a transparent overlay, so its ring is drawn on the sibling
 * .segFace. Reading the input itself would report the global :focus-visible outline
 * as visible while a sighted keyboard user sees nothing, so this reads the face and
 * demands an opaque indicator on it. Never assert a radio's focus on the input.
 *
 * A checked face already carries the opaque inset box-shadow of the checked rule, so
 * accepting either indicator there would keep passing with the :focus-visible rule
 * deleted — the guarantee could rot unnoticed. A checked radio therefore has to paint
 * the outline itself; only an unchecked face may satisfy this with a box-shadow.
 */
export async function expectSegmentFocusRing(
  radio: Locator,
  targetName: string,
): Promise<void> {
  const focus = await radio.evaluate((element) => {
    const face = element.nextElementSibling;
    if (face === null) return null;
    const style = getComputedStyle(face);
    const bounds = face.getBoundingClientRect();
    const transparentColors = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
    return {
      active: element === document.activeElement,
      boxShadow: style.boxShadow,
      boxShadowVisible: style.boxShadow !== "none"
        && !transparentColors.has(style.boxShadow),
      checked: (element as HTMLInputElement).checked,
      faceHeight: bounds.height,
      faceWidth: bounds.width,
      outline: style.outline,
      outlineVisible: style.outlineStyle !== "none"
        && Number.parseFloat(style.outlineWidth) > 0
        && !transparentColors.has(style.outlineColor),
    };
  });

  expect(focus, `${targetName} has a rendered segment face`).not.toBeNull();
  if (focus === null) throw new Error(`${targetName} has no segment face`);
  expect(focus.active, `${targetName} is document.activeElement`).toBe(true);
  expect(focus.faceWidth, `${targetName} face has width`).toBeGreaterThan(0);
  expect(focus.faceHeight, `${targetName} face has height`).toBeGreaterThan(0);
  expect(
    focus.checked
      ? focus.outlineVisible
      : focus.outlineVisible || focus.boxShadowVisible,
    `${targetName} paints an opaque focus ring on its visible face: ${JSON.stringify(focus)}`,
  ).toBe(true);
}

const ADD_OPTION_TOGGLE_NAME = "Add an option";
const ADD_OPTION_ROUTE = /\/api\/appointments\/[A-Za-z0-9_-]{24}\/options$/u;

/**
 * Adds one option to a DATE appointment from the board picker. A day appointment
 * needs nothing beyond the day, so one click is the whole suggestion — there is no
 * submit button to press.
 */
export async function addSuggestionViaBoard(
  page: Page,
  isoDay: string,
): Promise<void> {
  const toggle = page.getByRole("button", {
    name: ADD_OPTION_TOGGLE_NAME,
    exact: true,
  });
  await expect(toggle).toHaveCount(1);
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const panel = page.locator("#add-option-panel");
  await expect(panel).toBeVisible();

  await openMonth(panel, isoDay);
  const dayButton = panel.locator(`[data-date="${isoDay}"]`);
  await expect(dayButton).toBeEnabled();
  const added = page.waitForResponse((response) => (
    ADD_OPTION_ROUTE.test(new URL(response.url()).pathname)
    && response.request().method() === "POST"
  ));
  await dayButton.click();
  await added;

  /* The confirmation is set after the refresh, so reaching the option limit
     unmounts the picker before it can render. Settle on either outcome rather
     than waiting for a status that will never appear on the last allowed add. */
  await expect.poll(async () => (
    await page.getByRole("status")
      .getByText("Suggestion added.", { exact: true }).count() > 0
    || await toggle.count() === 0
  )).toBe(true);
}

export async function readAppointmentSnapshot(
  page: Page,
  publicId: string,
): Promise<AppointmentSnapshot> {
  const response = await page.request.get(
    `/api/appointments/${publicId}/snapshot`,
  );
  expect(response.status(), "snapshot endpoint status").toBe(200);

  const payload: unknown = await response.json();
  return appointmentSnapshotSchema.parse(payload);
}

/** Opens the collapsed administration surface on the appointment page. */
export async function openManageTools(page: Page): Promise<void> {
  const toggle = page.getByRole("button", {
    name: "Manage appointment",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
