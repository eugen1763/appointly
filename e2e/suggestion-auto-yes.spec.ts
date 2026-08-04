import type { Page, Request } from "@playwright/test";

import {
  addOptionSuccessSchema,
  joinParticipantSuccessSchema,
} from "../src/features/appointments/contracts";
import {
  addSuggestionViaBoard,
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 49 suggestion automatic Yes";
const INITIAL_DATE = "2032-05-14";
const INITIAL_DATE_LABEL = "May 14, 2032";
const SUGGESTED_DATE = "2032-05-15";
const SUGGESTED_DATE_LABEL = "May 15, 2032";

function exactRouteUrl(path: string): string {
  return new URL(path, E2E_BASE_URL).href;
}

function waitForExactPost(page: Page, path: string) {
  const expectedUrl = exactRouteUrl(path);
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === "POST"
  ));
}

test("a guest suggestion creates its automatic Yes without a response PUT", async ({
  ownerPage,
  page,
}) => {
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
  expect(initialSnapshot.options[0]).toMatchObject({
    kind: "DATE",
    startDate: INITIAL_DATE,
  });
  const initialRevision = initialSnapshot.appointment.revision;
  const initialOptionId = initialSnapshot.options[0].id;

  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  await expect(
    page.getByRole("form", { name: "Join appointment", exact: true }),
  ).toBeVisible();

  const guestName = `Task 49 Suggestion Guest ${created.publicId.slice(0, 8)}`;
  await page.getByLabel("Display name", { exact: true }).fill(guestName);
  const participantPath = `/api/appointments/${created.publicId}/participants`;
  const joinResponsePromise = waitForExactPost(page, participantPath);
  await page
    .getByRole("button", { name: "Join appointment", exact: true })
    .click();
  const joinResponse = await joinResponsePromise;
  expect(joinResponse.status()).toBe(201);
  const joinPayload: unknown = await joinResponse.json();
  const joined = joinParticipantSuccessSchema.parse(joinPayload);
  if (!("editUrl" in joined)) {
    throw new Error("Anonymous guest join did not return a private edit link");
  }
  expect(joined.revision).toBeGreaterThan(initialRevision);
  const guestParticipantId = joined.participantId;

  const initialResponseGroup = page.getByRole("group", {
    name: INITIAL_DATE_LABEL,
    exact: true,
  });
  await expect(initialResponseGroup).toBeVisible();
  await expect(page.getByRole("button", {
    name: "＋ Add an option",
    exact: true,
  })).toBeVisible();

  const optionsPath = `/api/appointments/${created.publicId}/options`;
  const optionsUrl = exactRouteUrl(optionsPath);
  const responseRoutePrefix = exactRouteUrl(
    `/api/appointments/${created.publicId}/responses/`,
  );
  const observedRequests: Array<{ readonly method: string; readonly url: string }> = [];
  const observeRequest = (request: Request): void => {
    if (request.url().startsWith(exactRouteUrl(
      `/api/appointments/${created.publicId}/`,
    ))) {
      observedRequests.push({ method: request.method(), url: request.url() });
    }
  };
  page.on("request", observeRequest);

  const optionResponsePromise = waitForExactPost(page, optionsPath);
  await addSuggestionViaBoard(page, SUGGESTED_DATE);
  const optionResponse = await optionResponsePromise;
  expect(optionResponse.status()).toBe(201);
  const optionPayload: unknown = await optionResponse.json();
  const added = addOptionSuccessSchema.parse(optionPayload);
  expect(added.optionId).not.toBe(initialOptionId);
  expect(added.revision).toBeGreaterThan(joined.revision);

  await expect(
    page.getByRole("status").getByText("Suggestion added.", { exact: true }),
  ).toBeVisible();

  const suggestedResponseGroup = page.getByRole("group", {
    name: SUGGESTED_DATE_LABEL,
    exact: true,
  });
  await expect(suggestedResponseGroup).toBeVisible();
  await expect(
    suggestedResponseGroup.getByRole("radio", { name: "Yes", exact: true }),
  ).toBeChecked();

  const ledger = page.getByRole("table", {
    name: "Participant availability by appointment option",
    exact: true,
  });
  await expect(ledger).toBeVisible();
  await expect(
    ledger.locator(`tbody th[data-option-id="${added.optionId}"]`),
  ).toHaveText(SUGGESTED_DATE_LABEL);
  const guestLedgerRow = ledger.getByRole("row").filter({
    has: page.getByRole("rowheader", {
      name: SUGGESTED_DATE_LABEL,
      exact: true,
    }),
  });
  await expect(guestLedgerRow).toHaveCount(1);
  // The guest answers in their own you-cell, so they never get a column of their own.
  await expect(
    guestLedgerRow.locator(
      `[data-option-id="${added.optionId}"][data-participant-id="${guestParticipantId}"]`,
    ),
  ).toHaveCount(1);
  await expect(
    guestLedgerRow.getByRole("radio", { name: "Yes", exact: true }),
  ).toBeChecked();

  const deleteButtons = page.getByRole("button", {
    name: "Delete an option",
    exact: true,
  });
  await expect(deleteButtons).toHaveCount(1);
  await expect(deleteButtons).toBeVisible();
  await expect(deleteButtons).toHaveAttribute(
    "data-delete-option",
    added.optionId,
  );

  const joinedSnapshot = await readAppointmentSnapshot(page, created.publicId);
  expect(joinedSnapshot.appointment.revision).toBe(added.revision);
  expect(joinedSnapshot.options).toHaveLength(2);
  expect(
    joinedSnapshot.options.filter(({ id }) => id === initialOptionId),
  ).toHaveLength(1);
  const newOptions = joinedSnapshot.options.filter(
    ({ id }) => id !== initialOptionId,
  );
  expect(newOptions).toHaveLength(1);
  expect(newOptions[0]).toEqual({
    id: added.optionId,
    kind: "DATE",
    startDate: SUGGESTED_DATE,
    creatorParticipantId: guestParticipantId,
    responses: [{ participantId: guestParticipantId, value: "YES" }],
    yesCount: 1,
    noCount: 0,
    canDelete: true,
  });

  expect(joinedSnapshot.viewer.activeParticipantId).toBe(guestParticipantId);
  expect(
    joinedSnapshot.participants.filter(({ id }) => id === guestParticipantId),
  ).toEqual([{ id: guestParticipantId, displayName: guestName }]);
  expect(
    joinedSnapshot.participants.filter(({ displayName }) => (
      displayName === guestName
    )),
  ).toEqual([{ id: guestParticipantId, displayName: guestName }]);
  // The viewer answers in the you-column, so their name is never also a
  // participant column: one identity, one place on the board.
  await expect(
    ledger.getByRole("columnheader", { name: guestName, exact: true }),
  ).toHaveCount(0);
  await expect(
    ledger.getByRole("columnheader", { name: "Your response", exact: true }),
  ).toHaveCount(1);

  page.off("request", observeRequest);

  const automaticYesMutationRequests = observedRequests.filter(
    ({ method, url }) => (
      (method === "POST" && url === optionsUrl)
      || (method === "PUT" && url.startsWith(responseRoutePrefix))
    ),
  );
  expect(automaticYesMutationRequests).toEqual([
    { method: "POST", url: optionsUrl },
  ]);
  expect(
    observedRequests.filter(({ method, url }) => (
      method === "PUT"
      && url === `${responseRoutePrefix}${added.optionId}`
    )),
  ).toHaveLength(0);
});
