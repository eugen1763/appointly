import type { Page } from "@playwright/test";

import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { expect, test } from "./fixtures";

interface TimedExpectation {
  readonly label: string;
  readonly timeZone: string;
}

async function resolveTimedExpectation(
  page: Page,
  startAt: number,
): Promise<TimedExpectation> {
  return page.evaluate((storedStartAt) => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    return {
      label: formatter.format(storedStartAt),
      timeZone: formatter.resolvedOptions().timeZone,
    };
  }, startAt);
}

test("timed options convert by browser zone while date-only options stay lexical", async ({
  ownerPage,
  browser,
}) => {
  const timedTitle = "Task 45 timed time-zone appointment";
  const timedCreated = await createAppointmentThroughWizard(ownerPage, {
    title: timedTitle,
    type: "DATE_TIME",
    optionLimit: 1,
    candidates: [{ kind: "DATE_TIME", startAtLocal: "2030-04-03T01:30" }],
  });
  const timedSnapshot = await readAppointmentSnapshot(
    ownerPage,
    timedCreated.publicId,
  );

  expect(timedSnapshot.appointment).toMatchObject({
    title: timedTitle,
    type: "DATE_TIME",
    optionLimit: 1,
  });
  expect(timedSnapshot.options).toHaveLength(1);
  const timedOption = timedSnapshot.options[0];
  expect(timedOption).toMatchObject({
    id: expect.any(String),
    kind: "DATE_TIME",
    startAt: expect.any(Number),
  });
  if (!timedOption || timedOption.kind !== "DATE_TIME") {
    throw new Error("Expected one DATE_TIME option in the timed snapshot.");
  }
  expect(timedOption.id).not.toBe("");
  expect(Number.isFinite(timedOption.startAt)).toBe(true);

  const dateTitle = "Task 45 date-only time-zone appointment";
  const dateCreated = await createAppointmentThroughWizard(ownerPage, {
    title: dateTitle,
    type: "DATE",
    optionLimit: 1,
    candidates: [{ kind: "DATE", startDate: "2030-04-03" }],
  });
  const dateSnapshot = await readAppointmentSnapshot(
    ownerPage,
    dateCreated.publicId,
  );

  expect(dateSnapshot.appointment).toMatchObject({
    title: dateTitle,
    type: "DATE",
    optionLimit: 1,
  });
  expect(dateSnapshot.options).toHaveLength(1);
  const dateOption = dateSnapshot.options[0];
  expect(dateOption).toMatchObject({
    id: expect.any(String),
    kind: "DATE",
    startDate: "2030-04-03",
  });
  if (!dateOption || dateOption.kind !== "DATE") {
    throw new Error("Expected one DATE option in the date-only snapshot.");
  }
  expect(dateOption.id).not.toBe("");

  const utcContext = await browser.newContext({
    locale: "en-US",
    timezoneId: "UTC",
  });

  try {
    const newYorkContext = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    try {
      const utcPage = await utcContext.newPage();
      const newYorkPage = await newYorkContext.newPage();

      await Promise.all([
        utcPage.goto(timedCreated.publicUrl),
        newYorkPage.goto(timedCreated.publicUrl),
      ]);
      await expect(utcPage).toHaveURL(timedCreated.publicUrl);
      await expect(newYorkPage).toHaveURL(timedCreated.publicUrl);

      const utcTimedHeader = utcPage.locator(
        `tbody th[data-option-id="${timedOption.id}"]`,
      );
      const newYorkTimedHeader = newYorkPage.locator(
        `tbody th[data-option-id="${timedOption.id}"]`,
      );
      await expect(utcTimedHeader).toBeVisible();
      await expect(newYorkTimedHeader).toBeVisible();

      const [utcExpected, newYorkExpected] = await Promise.all([
        resolveTimedExpectation(utcPage, timedOption.startAt),
        resolveTimedExpectation(newYorkPage, timedOption.startAt),
      ]);
      expect(utcExpected.timeZone).toBe("UTC");
      expect(newYorkExpected.timeZone).toBe("America/New_York");

      const utcTimedLabel = utcTimedHeader.locator("time");
      const newYorkTimedLabel = newYorkTimedHeader.locator("time");
      await expect(utcTimedLabel).toHaveText(utcExpected.label);
      await expect(newYorkTimedLabel).toHaveText(newYorkExpected.label);
      await expect(utcTimedHeader.locator("[data-time-zone]")).toHaveText(
        "UTC",
      );
      await expect(
        newYorkTimedHeader.locator("[data-time-zone]"),
      ).toHaveText("America/New_York");
      expect(await utcTimedLabel.textContent()).not.toBe(
        await newYorkTimedLabel.textContent(),
      );

      await Promise.all([
        utcPage.goto(dateCreated.publicUrl),
        newYorkPage.goto(dateCreated.publicUrl),
      ]);
      await expect(utcPage).toHaveURL(dateCreated.publicUrl);
      await expect(newYorkPage).toHaveURL(dateCreated.publicUrl);

      const utcDateHeader = utcPage.locator(
        `tbody th[data-option-id="${dateOption.id}"]`,
      );
      const newYorkDateHeader = newYorkPage.locator(
        `tbody th[data-option-id="${dateOption.id}"]`,
      );
      await expect(utcDateHeader).toBeVisible();
      await expect(newYorkDateHeader).toBeVisible();

      const utcDateLabel = utcDateHeader.locator("time");
      const newYorkDateLabel = newYorkDateHeader.locator("time");
      await expect(utcDateLabel).toHaveText("April 3, 2030");
      await expect(newYorkDateLabel).toHaveText("April 3, 2030");
      await expect(utcDateLabel).toHaveAttribute("datetime", "2030-04-03");
      await expect(newYorkDateLabel).toHaveAttribute(
        "datetime",
        "2030-04-03",
      );
    } finally {
      await newYorkContext.close();
    }
  } finally {
    await utcContext.close();
  }
});
