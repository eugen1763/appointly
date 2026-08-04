import type {
  BrowserContext,
  Page,
  Response,
} from "@playwright/test";

import {
  addOptionSuccessSchema,
  appointmentRouteContracts,
  joinParticipantSuccessSchema,
} from "../src/features/appointments/contracts";
import {
  addSuggestionViaBoard,
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import {
  countAppointmentParticipants,
  seedAppointmentParticipants,
} from "./database-helpers";
import { expect, test } from "./fixtures";

const TITLE = "Task 51 exact boundary appointment";
const INITIAL_DATE = "2034-06-10";
const FIRST_SUGGESTED_DATE = "2034-06-11";
const SECOND_SUGGESTED_DATE = "2034-06-12";
const INITIAL_DATE_LABEL = "June 10, 2034";
const FIRST_SUGGESTED_DATE_LABEL = "June 11, 2034";
const SECOND_SUGGESTED_DATE_LABEL = "June 12, 2034";
const GUEST_SESSION_COOKIE_NAME = "appointly_guest_session";
const ADD_OPTION_TOGGLE = "＋ Add an option";
const PARTICIPANT_LIMIT_MESSAGE = "This appointment already has 200 participants.";

function waitForExactPost(page: Page, path: string): Promise<Response> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === "POST"
  ));
}

async function expectNoGuestSessionCookie(
  context: BrowserContext,
  publicUrl: string,
): Promise<void> {
  const cookies = await context.cookies(publicUrl);
  expect(
    cookies.filter(({ name }) => name === GUEST_SESSION_COOKIE_NAME),
    "fresh anonymous context guest-session cookies",
  ).toEqual([]);
}

test("the option and participant limits hold at their exact boundaries", async ({
  browser,
  ownerPage,
  page,
}) => {
  test.setTimeout(90_000);

  const created = await createAppointmentThroughWizard(ownerPage, {
    title: TITLE,
    type: "DATE",
    optionLimit: 3,
    candidates: [{ kind: "DATE", startDate: INITIAL_DATE }],
  });

  const initialSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  expect(initialSnapshot.appointment).toMatchObject({
    publicId: created.publicId,
    title: TITLE,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 3,
    finalOptionId: null,
    revision: 1,
  });
  expect(initialSnapshot.options).toHaveLength(1);
  const initialOption = initialSnapshot.options[0];
  if (initialOption === undefined || initialOption.kind !== "DATE") {
    throw new Error("Creation did not return the expected DATE option.");
  }
  expect(initialOption.startDate).toBe(INITIAL_DATE);
  const initialOptionId = initialOption.id;
  const initialRevision = initialSnapshot.appointment.revision;

  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  const initialJoinForm = page.getByRole("form", {
    name: "Join appointment",
    exact: true,
  });
  await expect(initialJoinForm).toBeVisible();
  const suggestionGuestName = `Boundary Suggester ${created.publicId.slice(0, 8)}`;
  await initialJoinForm
    .getByLabel("Display name", { exact: true })
    .fill(suggestionGuestName);
  const participantPath = `/api/appointments/${created.publicId}/participants`;
  const initialJoinResponsePromise = waitForExactPost(page, participantPath);
  await initialJoinForm
    .getByRole("button", { name: "Join appointment", exact: true })
    .click();
  const initialJoinResponse = await initialJoinResponsePromise;
  expect(initialJoinResponse.status()).toBe(201);
  const initialJoinPayload: unknown = await initialJoinResponse.json();
  const initialJoin = joinParticipantSuccessSchema.parse(initialJoinPayload);
  if (!("editUrl" in initialJoin)) {
    throw new Error("Anonymous suggestion guest did not receive a private edit link.");
  }
  expect(initialJoin.revision).toBeGreaterThan(initialRevision);

  await expect(page.getByRole("group", {
    name: INITIAL_DATE_LABEL,
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: ADD_OPTION_TOGGLE,
    exact: true,
  })).toBeVisible();

  const optionsPath = `/api/appointments/${created.publicId}/options`;
  const firstOptionResponsePromise = waitForExactPost(page, optionsPath);
  await addSuggestionViaBoard(page, FIRST_SUGGESTED_DATE);
  const firstOptionResponse = await firstOptionResponsePromise;
  expect(firstOptionResponse.status()).toBe(201);
  const firstOptionPayload: unknown = await firstOptionResponse.json();
  const firstAddedOption = addOptionSuccessSchema.parse(firstOptionPayload);
  expect(firstAddedOption.optionId).not.toBe(initialOptionId);
  expect(firstAddedOption.revision).toBeGreaterThan(initialJoin.revision);

  await expect(
    page.getByRole("status").getByText("Suggestion added.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("form", {
    name: "Suggest an option",
    exact: true,
  })).toBeVisible();
  // One click is one complete suggestion: nothing stays picked afterwards.
  await expect(
    page.locator(`[data-date="${FIRST_SUGGESTED_DATE}"]`),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", {
    name: FIRST_SUGGESTED_DATE_LABEL,
    exact: true,
  })).toBeVisible();

  const secondOptionResponsePromise = waitForExactPost(page, optionsPath);
  await addSuggestionViaBoard(page, SECOND_SUGGESTED_DATE);
  const secondOptionResponse = await secondOptionResponsePromise;
  expect(secondOptionResponse.status()).toBe(201);
  const secondOptionPayload: unknown = await secondOptionResponse.json();
  const secondAddedOption = addOptionSuccessSchema.parse(secondOptionPayload);
  expect(secondAddedOption.optionId).not.toBe(initialOptionId);
  expect(secondAddedOption.optionId).not.toBe(firstAddedOption.optionId);
  expect(secondAddedOption.revision).toBeGreaterThan(firstAddedOption.revision);

  const responseRegion = page.getByRole("region", {
    name: "Your response",
    exact: true,
  });
  const visibleOptionGroups = responseRegion.getByRole("group");
  await expect(visibleOptionGroups).toHaveCount(3);
  for (const label of [
    INITIAL_DATE_LABEL,
    FIRST_SUGGESTED_DATE_LABEL,
    SECOND_SUGGESTED_DATE_LABEL,
  ]) {
    await expect(responseRegion.getByRole("group", {
      name: label,
      exact: true,
    })).toBeVisible();
  }
  await expect(page.getByRole("button", {
    name: ADD_OPTION_TOGGLE,
    exact: true,
  })).toHaveCount(0);
  await expect(page.getByRole("form", {
    name: "Suggest an option",
    exact: true,
  })).toHaveCount(0);
  await expect(
    page.getByRole("status").getByText(
      "Option limit reached. No more suggestions can be added.",
      { exact: true },
    ),
  ).toBeVisible();

  const optionLimitSnapshot = await readAppointmentSnapshot(
    page,
    created.publicId,
  );
  expect(optionLimitSnapshot.appointment.revision).toBe(
    secondAddedOption.revision,
  );
  expect(new Set([
    initialOptionId,
    firstAddedOption.optionId,
    secondAddedOption.optionId,
  ]).size).toBe(3);
  expect(optionLimitSnapshot.options.map((option) => {
    if (option.kind !== "DATE") {
      throw new Error("Option-limit snapshot contained a non-DATE option.");
    }
    return { id: option.id, startDate: option.startDate };
  })).toEqual([
    { id: initialOptionId, startDate: INITIAL_DATE },
    { id: firstAddedOption.optionId, startDate: FIRST_SUGGESTED_DATE },
    { id: secondAddedOption.optionId, startDate: SECOND_SUGGESTED_DATE },
  ]);
  const optionLimitRevision = optionLimitSnapshot.appointment.revision;

  expect(seedAppointmentParticipants(created.publicId, 199)).toBe(199);

  let twoHundredthContext: BrowserContext | undefined;
  let rejectedContext: BrowserContext | undefined;
  try {
    twoHundredthContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    await expectNoGuestSessionCookie(twoHundredthContext, created.publicUrl);
    const twoHundredthPage = await twoHundredthContext.newPage();
    await twoHundredthPage.goto(created.publicUrl);
    await expect(twoHundredthPage).toHaveURL(created.publicUrl);
    await expectNoGuestSessionCookie(twoHundredthContext, created.publicUrl);

    const twoHundredthJoinForm = twoHundredthPage.getByRole("form", {
      name: "Join appointment",
      exact: true,
    });
    await expect(twoHundredthJoinForm).toBeVisible();
    await twoHundredthJoinForm
      .getByLabel("Display name", { exact: true })
      .fill(`Boundary Guest 200 ${created.publicId.slice(0, 8)}`);
    const twoHundredthJoinResponsePromise = waitForExactPost(
      twoHundredthPage,
      participantPath,
    );
    await twoHundredthJoinForm
      .getByRole("button", { name: "Join appointment", exact: true })
      .click();
    const twoHundredthJoinResponse = await twoHundredthJoinResponsePromise;
    expect(twoHundredthJoinResponse.status()).toBe(201);
    const twoHundredthJoinPayload: unknown = await twoHundredthJoinResponse.json();
    const twoHundredthJoin = joinParticipantSuccessSchema.parse(
      twoHundredthJoinPayload,
    );
    if (!("editUrl" in twoHundredthJoin)) {
      throw new Error("Anonymous 200th participant did not receive a private edit link.");
    }
    expect(twoHundredthJoin.revision).toBeGreaterThan(optionLimitRevision);

    const successfulSessionCookies = (
      await twoHundredthContext.cookies(created.publicUrl)
    ).filter(({ name }) => name === GUEST_SESSION_COOKIE_NAME);
    expect(successfulSessionCookies).toHaveLength(1);
    expect(successfulSessionCookies[0]).toMatchObject({
      name: GUEST_SESSION_COOKIE_NAME,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      secure: false,
    });
    expect(successfulSessionCookies[0]?.value).toMatch(
      /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u,
    );
    expect(countAppointmentParticipants(created.publicId)).toBe(200);

    rejectedContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    await expectNoGuestSessionCookie(rejectedContext, created.publicUrl);
    const rejectedPage = await rejectedContext.newPage();
    await rejectedPage.goto(created.publicUrl);
    await expect(rejectedPage).toHaveURL(created.publicUrl);
    await expectNoGuestSessionCookie(rejectedContext, created.publicUrl);

    const rejectedJoinForm = rejectedPage.getByRole("form", {
      name: "Join appointment",
      exact: true,
    });
    await expect(rejectedJoinForm).toBeVisible();
    await rejectedJoinForm
      .getByLabel("Display name", { exact: true })
      .fill(`Boundary Guest 201 ${created.publicId.slice(0, 8)}`);
    const rejectedJoinResponsePromise = waitForExactPost(
      rejectedPage,
      participantPath,
    );
    await rejectedJoinForm
      .getByRole("button", { name: "Join appointment", exact: true })
      .click();
    const rejectedJoinResponse = await rejectedJoinResponsePromise;
    expect(rejectedJoinResponse.status()).toBe(409);
    const rejectedJoinPayload: unknown = await rejectedJoinResponse.json();
    const rejectedJoinError = appointmentRouteContracts.joinParticipant.errors
      .bodySchema.parse(rejectedJoinPayload);
    expect(rejectedJoinError).toEqual({
      error: {
        code: "PARTICIPANT_LIMIT_REACHED",
        message: PARTICIPANT_LIMIT_MESSAGE,
      },
    });
    expect(rejectedJoinError.error.code).not.toBe("RATE_LIMITED");
    await expect(rejectedJoinForm.getByRole("alert")).toHaveText(
      PARTICIPANT_LIMIT_MESSAGE,
    );
    await expectNoGuestSessionCookie(rejectedContext, created.publicUrl);
    expect(countAppointmentParticipants(created.publicId)).toBe(200);
  } finally {
    await Promise.all([
      rejectedContext?.close(),
      twoHundredthContext?.close(),
    ]);
  }
});
