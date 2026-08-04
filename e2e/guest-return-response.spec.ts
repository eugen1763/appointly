import type { Page } from "@playwright/test";

import {
  guestAccessSuccessSchema,
  joinParticipantSuccessSchema,
  putResponseSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 47 guest return";
const GUEST_NAME = "Task 47 Returning Guest";
const DATE_OPTIONS = [
  { startDate: "2030-04-03", label: "April 3, 2030" },
  { startDate: "2030-04-04", label: "April 4, 2030" },
  { startDate: "2030-04-05", label: "April 5, 2030" },
] as const;

type ResponseValue = "YES" | "NO" | null;


function waitForExactRouteResponse(
  page: Page,
  method: "POST" | "PUT",
  path: string,
) {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

async function selectAndSaveResponse(
  page: Page,
  publicId: string,
  optionId: string,
  optionLabel: string,
  controlLabel: "Yes" | "No" | "Unanswered",
  expectedValue: ResponseValue,
  previousRevision: number,
): Promise<number> {
  const group = page.getByRole("group", { name: optionLabel, exact: true });
  const radio = group.getByRole("radio", { name: controlLabel, exact: true });
  const responsePromise = waitForExactRouteResponse(
    page,
    "PUT",
    `/api/appointments/${publicId}/responses/${optionId}`,
  );

  await radio.check();
  const response = await responsePromise;
  expect(response.status(), `saving ${controlLabel} for ${optionLabel}`).toBe(200);

  const payload: unknown = await response.json();
  const saved = putResponseSuccessSchema.parse(payload);
  expect(saved.value).toBe(expectedValue);
  expect(saved.revision).toBeGreaterThan(previousRevision);
  await expect(radio).toBeChecked();
  await expect(group.locator(`[data-save-status="${optionId}"]`)).toHaveText("Saved");
  return saved.revision;
}

function assertGuestIdentity(
  snapshot: AppointmentSnapshot,
  participantId: string,
): void {
  expect(snapshot.viewer.activeParticipantId).toBe(participantId);
  const sameNameParticipants = snapshot.participants.filter(
    ({ displayName }) => displayName === GUEST_NAME,
  );
  expect(sameNameParticipants).toHaveLength(1);
  expect(sameNameParticipants[0]?.id).toBe(participantId);
}

function assertResponses(
  snapshot: AppointmentSnapshot,
  optionIds: readonly string[],
  participantId: string,
  expectedValues: readonly ResponseValue[],
): void {
  expect(snapshot.options.map(({ id }) => id)).toEqual(optionIds);
  expect(expectedValues).toHaveLength(optionIds.length);

  snapshot.options.forEach((option, index) => {
    const participantResponses = option.responses.filter(
      (response) => response.participantId === participantId,
    );
    const expectedValue = expectedValues[index];
    if (expectedValue === null) {
      expect(participantResponses).toHaveLength(0);
      return;
    }
    expect(participantResponses).toHaveLength(1);
    expect(participantResponses[0]?.value).toBe(expectedValue);
  });
}

test("guest returns with the private link and edits the same responses", async ({
  ownerPage,
  page,
  browser,
}) => {
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: TITLE,
    type: "DATE",
    optionLimit: 3,
    candidates: [
      { kind: "DATE", startDate: DATE_OPTIONS[0].startDate },
      { kind: "DATE", startDate: DATE_OPTIONS[1].startDate },
      { kind: "DATE", startDate: DATE_OPTIONS[2].startDate },
    ],
  });

  const ownerSnapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
  expect(ownerSnapshot.appointment).toMatchObject({
    publicId: created.publicId,
    title: TITLE,
    type: "DATE",
    optionLimit: 3,
  });
  expect(ownerSnapshot.options).toHaveLength(3);
  expect(ownerSnapshot.options.map(({ kind }) => kind)).toEqual([
    "DATE",
    "DATE",
    "DATE",
  ]);
  expect(ownerSnapshot.options.map((option) => (
    option.kind === "DATE" ? option.startDate : null
  ))).toEqual(DATE_OPTIONS.map(({ startDate }) => startDate));
  const optionIds = ownerSnapshot.options.map(({ id }) => id);
  expect(new Set(optionIds).size).toBe(3);

  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  const anonymousSnapshot = await readAppointmentSnapshot(page, created.publicId);
  expect(anonymousSnapshot.viewer.kind).toBe("anonymous");
  expect(anonymousSnapshot.viewer.activeParticipantId).toBeNull();
  await expect(
    page.getByRole("form", { name: "Join appointment", exact: true }),
  ).toBeVisible();

  await page.getByLabel("Display name", { exact: true }).fill(GUEST_NAME);
  const joinResponsePromise = waitForExactRouteResponse(
    page,
    "POST",
    `/api/appointments/${created.publicId}/participants`,
  );
  await page.getByRole("button", { name: "Join appointment", exact: true }).click();
  const joinResponse = await joinResponsePromise;
  expect(joinResponse.status()).toBe(201);
  const joinPayload: unknown = await joinResponse.json();
  const joined = joinParticipantSuccessSchema.parse(joinPayload);
  if (!("editUrl" in joined)) {
    throw new Error("Anonymous join did not return a private edit link");
  }

  const privateLinkRegion = page.getByRole("region", {
    name: "Save your private edit link",
    exact: true,
  });
  await expect(privateLinkRegion).toBeVisible();
  await expect(
    page.getByRole("group", { name: DATE_OPTIONS[0].label, exact: true }),
  ).toBeVisible();
  await expect(privateLinkRegion).toBeVisible();
  const privateLink = privateLinkRegion.getByRole("link", {
    name: "Private edit link",
    exact: true,
  });
  const privateHref = await privateLink.getAttribute("href");
  if (privateHref === null) throw new Error("Private edit link has no href");
  expect(joined.editUrl === privateHref, "UI exposes the joined guest edit URL").toBe(true);

  const editUrl = new URL(privateHref, E2E_BASE_URL);
  expect(editUrl.origin).toBe(E2E_BASE_URL);
  expect(editUrl.pathname).toBe(`/a/${created.publicId}/edit`);
  expect(editUrl.search).toBe("");
  const fragment = new URLSearchParams(editUrl.hash.slice(1));
  const fragmentEntries = Array.from(fragment.entries());
  expect(fragmentEntries.length).toBe(2);
  expect(
    fragmentEntries.filter(([key]) => key === "participant").length,
  ).toBe(1);
  expect(fragmentEntries.filter(([key]) => key === "token").length).toBe(1);
  const editParticipantId = fragment.get("participant");
  expect(editParticipantId).toBe(joined.participantId);
  expect(fragment.get("token")?.length ?? 0).toBeGreaterThan(0);

  await page.context().grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: E2E_BASE_URL },
  );
  await page.getByRole("button", { name: "Copy private link", exact: true }).click();
  await expect(
    page
      .getByRole("region", {
        name: "Save your private edit link",
        exact: true,
      })
      .getByRole("status"),
  ).toHaveText("Private link copied.");
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(
    clipboardText === privateHref,
    "clipboard contains the exact private href",
  ).toBe(true);

  let revision = joined.revision;
  revision = await selectAndSaveResponse(
    page,
    created.publicId,
    optionIds[0],
    DATE_OPTIONS[0].label,
    "Yes",
    "YES",
    revision,
  );
  revision = await selectAndSaveResponse(
    page,
    created.publicId,
    optionIds[1],
    DATE_OPTIONS[1].label,
    "No",
    "NO",
    revision,
  );
  revision = await selectAndSaveResponse(
    page,
    created.publicId,
    optionIds[2],
    DATE_OPTIONS[2].label,
    "Yes",
    "YES",
    revision,
  );
  const snapshotBeforeClear = await readAppointmentSnapshot(
    page,
    created.publicId,
  );
  assertResponses(
    snapshotBeforeClear,
    optionIds,
    joined.participantId,
    ["YES", "NO", "YES"],
  );
  await expect(
    page.getByRole("group", {
      name: DATE_OPTIONS[2].label,
      exact: true,
    }).getByRole("radio", { name: "Yes", exact: true }),
  ).toBeChecked();
  revision = await selectAndSaveResponse(
    page,
    created.publicId,
    optionIds[2],
    DATE_OPTIONS[2].label,
    "Unanswered",
    null,
    revision,
  );

  const guestSnapshot = await readAppointmentSnapshot(page, created.publicId);
  expect(guestSnapshot.appointment.revision).toBe(revision);
  if (editParticipantId === null) {
    throw new Error("Private edit link has no participant");
  }
  assertGuestIdentity(guestSnapshot, editParticipantId);
  assertResponses(
    guestSnapshot,
    optionIds,
    editParticipantId,
    ["YES", "NO", null],
  );
  const initialParticipantIds = guestSnapshot.participants.map(({ id }) => id).sort();

  const returnContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  try {
    const returnPage = await returnContext.newPage();
    const exchangeResponsePromise = waitForExactRouteResponse(
      returnPage,
      "POST",
      `/api/appointments/${created.publicId}/guest-access`,
    );
    await returnPage.goto(privateHref);
    const exchangeResponse = await exchangeResponsePromise;
    expect(exchangeResponse.status()).toBe(200);
    const exchangePayload: unknown = await exchangeResponse.json();
    const exchanged = guestAccessSuccessSchema.parse(exchangePayload);
    expect(exchanged.participantId).toBe(editParticipantId);
    await expect(returnPage).toHaveURL(created.publicUrl);

    const savedParticipant = returnPage.getByRole("region", {
      name: "Saved participant",
      exact: true,
    });
    await expect(savedParticipant).toContainText(`Returning as ${GUEST_NAME}`);

    const returnedSnapshot = await readAppointmentSnapshot(
      returnPage,
      created.publicId,
    );
    assertGuestIdentity(returnedSnapshot, editParticipantId);
    expect(returnedSnapshot.participants.map(({ id }) => id).sort()).toEqual(
      initialParticipantIds,
    );
    assertResponses(
      returnedSnapshot,
      optionIds,
      editParticipantId,
      ["YES", "NO", null],
    );

    revision = returnedSnapshot.appointment.revision;
    revision = await selectAndSaveResponse(
      returnPage,
      created.publicId,
      optionIds[0],
      DATE_OPTIONS[0].label,
      "No",
      "NO",
      revision,
    );
    revision = await selectAndSaveResponse(
      returnPage,
      created.publicId,
      optionIds[1],
      DATE_OPTIONS[1].label,
      "Unanswered",
      null,
      revision,
    );
    revision = await selectAndSaveResponse(
      returnPage,
      created.publicId,
      optionIds[2],
      DATE_OPTIONS[2].label,
      "Yes",
      "YES",
      revision,
    );

    const finalSnapshot = await readAppointmentSnapshot(
      returnPage,
      created.publicId,
    );
    expect(finalSnapshot.appointment.revision).toBe(revision);
    assertGuestIdentity(finalSnapshot, editParticipantId);
    expect(finalSnapshot.participants.map(({ id }) => id).sort()).toEqual(
      initialParticipantIds,
    );
    assertResponses(
      finalSnapshot,
      optionIds,
      editParticipantId,
      ["NO", null, "YES"],
    );
  } finally {
    await returnContext.close();
  }
});
