import type { Locator, Page } from "@playwright/test";

import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import { expect, test } from "./fixtures";

const TYPE_LABELS: Record<
  AppointmentSnapshot["appointment"]["type"],
  string
> = {
  DATE: "Day",
  DATE_TIME: "Date and time",
  DATE_RANGE: "Date range",
  DATE_TIME_RANGE: "Date and time range",
};

interface TimedExpectation {
  readonly startAt: number;
  readonly endAt?: number;
  readonly label: string;
  readonly timeZone: string;
}

async function resolveTimedExpectation(
  page: Page,
  startLocal: string,
  endLocal?: string,
): Promise<TimedExpectation> {
  return page.evaluate(
    ({ startLocalValue, endLocalValue }) => {
      const startAt = new Date(startLocalValue).getTime();
      const endAt = endLocalValue === undefined
        ? undefined
        : new Date(endLocalValue).getTime();
      const formatter = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      const startLabel = formatter.format(startAt);

      return {
        startAt,
        endAt,
        label: endAt === undefined
          ? startLabel
          : `${startLabel} – ${formatter.format(endAt)}`,
        timeZone: formatter.resolvedOptions().timeZone,
      };
    },
    { startLocalValue: startLocal, endLocalValue: endLocal },
  );
}

function expectSingleOption(
  snapshot: AppointmentSnapshot,
  title: string,
  type: AppointmentSnapshot["appointment"]["type"],
): AppointmentSnapshot["options"][number] {
  expect(snapshot.appointment.title).toBe(title);
  expect(snapshot.appointment.type).toBe(type);
  expect(snapshot.appointment.optionLimit).toBe(1);
  expect(snapshot.options).toHaveLength(1);

  const option = snapshot.options[0];
  expect(option.kind).toBe(type);
  return option;
}

async function openPublicOption(
  page: Page,
  publicUrl: string,
  title: string,
  type: AppointmentSnapshot["appointment"]["type"],
  optionId: string,
): Promise<Locator> {
  await page.goto(publicUrl);

  const heading = page.getByRole("heading", {
    level: 1,
    name: title,
    exact: true,
  });
  await expect(heading).toBeVisible();
  await expect(
    heading.locator("..").getByText(TYPE_LABELS[type], { exact: true }),
  ).toBeVisible();

  const optionHeader = page.locator(`tbody th[data-option-id="${optionId}"]`);
  await expect(optionHeader).toBeVisible();
  return optionHeader;
}

test("DATE preserves a calendar day in storage and display", async ({
  ownerPage,
}) => {
  const title = "Task 44 date appointment";
  const startDate = "2030-04-03";
  const created = await createAppointmentThroughWizard(ownerPage, {
    title,
    type: "DATE",
    optionLimit: 1,
    candidates: [{ kind: "DATE", startDate }],
  });

  const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
  const option = expectSingleOption(snapshot, title, "DATE");
  expect(option).toMatchObject({
    id: expect.any(String),
    creatorParticipantId: expect.any(String),
    kind: "DATE",
    startDate,
  });

  const optionHeader = await openPublicOption(
    ownerPage,
    created.publicUrl,
    title,
    "DATE",
    option.id,
  );
  await expect(optionHeader).toHaveText("April 3, 2030");
});

test("DATE_TIME preserves the browser-local instant and display", async ({
  ownerPage,
}) => {
  const title = "Task 44 date-time appointment";
  const startAtLocal = "2030-04-03T09:30";
  const expected = await resolveTimedExpectation(ownerPage, startAtLocal);
  const created = await createAppointmentThroughWizard(ownerPage, {
    title,
    type: "DATE_TIME",
    optionLimit: 1,
    candidates: [{ kind: "DATE_TIME", startAtLocal }],
  });

  const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
  const option = expectSingleOption(snapshot, title, "DATE_TIME");
  expect(option).toMatchObject({
    id: expect.any(String),
    creatorParticipantId: expect.any(String),
    kind: "DATE_TIME",
    startAt: expected.startAt,
  });

  const optionHeader = await openPublicOption(
    ownerPage,
    created.publicUrl,
    title,
    "DATE_TIME",
    option.id,
  );
  await expect(optionHeader.locator("time")).toHaveText(expected.label);
  await expect(optionHeader.locator("[data-time-zone]")).toHaveText(
    expected.timeZone,
  );
});

test("DATE_RANGE preserves calendar boundaries in storage and display", async ({
  ownerPage,
}) => {
  const title = "Task 44 date-range appointment";
  const startDate = "2030-04-03";
  const endDate = "2030-04-05";
  const created = await createAppointmentThroughWizard(ownerPage, {
    title,
    type: "DATE_RANGE",
    optionLimit: 1,
    candidates: [{ kind: "DATE_RANGE", startDate, endDate }],
  });

  const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
  const option = expectSingleOption(snapshot, title, "DATE_RANGE");
  expect(option).toMatchObject({
    id: expect.any(String),
    creatorParticipantId: expect.any(String),
    kind: "DATE_RANGE",
    startDate,
    endDate,
  });

  const optionHeader = await openPublicOption(
    ownerPage,
    created.publicUrl,
    title,
    "DATE_RANGE",
    option.id,
  );
  await expect(optionHeader).toHaveText(
    "April 3, 2030 – April 5, 2030",
  );
});

test("DATE_TIME_RANGE preserves browser-local boundaries and display", async ({
  ownerPage,
}) => {
  const title = "Task 44 date-time-range appointment";
  const startAtLocal = "2030-04-03T09:30";
  const endAtLocal = "2030-04-03T11:00";
  const expected = await resolveTimedExpectation(
    ownerPage,
    startAtLocal,
    endAtLocal,
  );
  const created = await createAppointmentThroughWizard(ownerPage, {
    title,
    type: "DATE_TIME_RANGE",
    optionLimit: 1,
    candidates: [{ kind: "DATE_TIME_RANGE", startAtLocal, endAtLocal }],
  });

  const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
  const option = expectSingleOption(snapshot, title, "DATE_TIME_RANGE");
  expect(option).toMatchObject({
    id: expect.any(String),
    creatorParticipantId: expect.any(String),
    kind: "DATE_TIME_RANGE",
    startAt: expected.startAt,
    endAt: expected.endAt,
  });

  const optionHeader = await openPublicOption(
    ownerPage,
    created.publicUrl,
    title,
    "DATE_TIME_RANGE",
    option.id,
  );
  await expect(optionHeader.locator("time")).toHaveText(expected.label);
  await expect(optionHeader.locator("[data-time-zone]")).toHaveText(
    expected.timeZone,
  );
});
