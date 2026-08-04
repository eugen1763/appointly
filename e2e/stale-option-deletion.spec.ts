import type { Page, Response } from "@playwright/test";

import {
  appointmentRouteContracts,
  createAppointmentSuccessSchema,
  deleteOptionRequestSchema,
  joinParticipantRequestSchema,
  joinParticipantSuccessSchema,
  putResponseRequestSchema,
  putResponseSuccessSchema,
  revisionSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 53 stale option deletion";
const OWNER_NAME = "Task 53 Deletion Owner";
const DATE = "2035-08-14";
const DATE_LABEL = "August 14, 2035";
const CONFIRMATION_MESSAGE = "Confirm deletion before removing this option.";
const STALE_MESSAGE =
  "Responses changed. Review the current participants and confirm again.";
const STALE_NOTICE =
  "Responses changed. Review the current Yes participants and confirm again.";

type RouteMethod = "POST" | "PUT" | "DELETE";

function waitForExactRouteResponse(
  page: Page,
  method: RouteMethod,
  path: string,
): Promise<Response> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

function assertActiveAppointment(
  snapshot: AppointmentSnapshot,
  publicId: string,
  revision: number,
): void {
  expect(snapshot.appointment).toEqual({
    publicId,
    title: TITLE,
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 1,
    finalOptionId: null,
    revision,
  });
}

function assertParticipants(
  snapshot: AppointmentSnapshot,
  ownerParticipantId: string,
  guestParticipantId: string,
  guestName: string,
): void {
  expect(snapshot.participants).toHaveLength(2);
  expect(snapshot.participants).toEqual(expect.arrayContaining([
    { id: ownerParticipantId, displayName: OWNER_NAME },
    { id: guestParticipantId, displayName: guestName },
  ]));
}

function assertOptionGraph(
  snapshot: AppointmentSnapshot,
  optionId: string,
  ownerParticipantId: string,
  guestParticipantId: string,
  guestValue: "YES" | "NO",
  canDelete: boolean,
): void {
  expect(snapshot.options).toHaveLength(1);
  const option = snapshot.options[0];
  if (option === undefined || option.kind !== "DATE") {
    throw new Error("The appointment did not retain the captured DATE option");
  }

  expect(option.responses).toHaveLength(2);
  expect(option).toEqual({
    id: optionId,
    kind: "DATE",
    startDate: DATE,
    creatorParticipantId: ownerParticipantId,
    responses: expect.arrayContaining([
      { participantId: ownerParticipantId, value: "YES" },
      { participantId: guestParticipantId, value: guestValue },
    ]),
    yesCount: guestValue === "YES" ? 2 : 1,
    noCount: guestValue === "NO" ? 1 : 0,
    canDelete,
  });
}

test("stale deletion confirmation refreshes before removing the option", async ({
  ownerPage,
  page,
}) => {
  const createResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "POST",
    "/api/appointments",
  );
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: TITLE,
    ownerDisplayName: OWNER_NAME,
    type: "DATE",
    optionLimit: 1,
    candidates: [{ kind: "DATE", startDate: DATE }],
  });
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const createPayload: unknown = await createResponse.json();
  expect(createAppointmentSuccessSchema.parse(createPayload)).toEqual({
    publicId: created.publicId,
    publicUrl: created.publicUrl,
    revision: 1,
  });

  const initialSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  assertActiveAppointment(initialSnapshot, created.publicId, 1);
  expect(initialSnapshot.viewer.kind).toBe("authenticated");
  const ownerParticipantId = initialSnapshot.viewer.activeParticipantId;
  if (ownerParticipantId === null) {
    throw new Error("The appointment owner did not have an active participant");
  }
  expect(initialSnapshot.participants).toEqual([
    { id: ownerParticipantId, displayName: OWNER_NAME },
  ]);
  expect(initialSnapshot.options).toHaveLength(1);
  const initialOption = initialSnapshot.options[0];
  if (initialOption === undefined || initialOption.kind !== "DATE") {
    throw new Error("Creation did not return the expected DATE option");
  }
  const optionId = initialOption.id;
  const initialRevision = initialSnapshot.appointment.revision;
  expect(initialOption).toEqual({
    id: optionId,
    kind: "DATE",
    startDate: DATE,
    creatorParticipantId: ownerParticipantId,
    responses: [{ participantId: ownerParticipantId, value: "YES" }],
    yesCount: 1,
    noCount: 0,
    canDelete: true,
  });

  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  const joinForm = page.getByRole("form", {
    name: "Join appointment",
    exact: true,
  });
  await expect(joinForm).toBeVisible();
  const guestName = `Task 53 Deletion Guest ${created.publicId.slice(0, 8)}`;
  await joinForm.getByLabel("Display name", { exact: true }).fill(guestName);
  const participantsPath =
    `/api/appointments/${created.publicId}/participants`;
  const joinResponsePromise = waitForExactRouteResponse(
    page,
    "POST",
    participantsPath,
  );
  await joinForm
    .getByRole("button", { name: "Join appointment", exact: true })
    .click();
  const joinResponse = await joinResponsePromise;
  expect(joinResponse.status()).toBe(201);
  expect(joinParticipantRequestSchema.parse(
    joinResponse.request().postDataJSON(),
  )).toEqual({ displayName: guestName });
  const joinPayload: unknown = await joinResponse.json();
  const joined = joinParticipantSuccessSchema.parse(joinPayload);
  if (!("editUrl" in joined)) {
    throw new Error("Anonymous guest join did not return a private edit link");
  }
  const guestParticipantId = joined.participantId;
  const joinRevision = joined.revision;
  expect(guestParticipantId).not.toBe(ownerParticipantId);
  expect(joinRevision).toBeGreaterThan(initialRevision);

  const responsePath =
    `/api/appointments/${created.publicId}/responses/${optionId}`;
  const guestResponseGroup = page.getByRole("group", {
    name: DATE_LABEL,
    exact: true,
  });
  await expect(guestResponseGroup).toBeVisible();
  const guestYes = guestResponseGroup.getByRole("radio", {
    name: "Yes",
    exact: true,
  });
  await expect(guestYes).not.toBeChecked();
  const yesResponsePromise = waitForExactRouteResponse(
    page,
    "PUT",
    responsePath,
  );
  await guestYes.check();
  const yesResponse = await yesResponsePromise;
  expect(yesResponse.status()).toBe(200);
  expect(putResponseRequestSchema.parse(
    yesResponse.request().postDataJSON(),
  )).toEqual({ participantId: guestParticipantId, value: "YES" });
  const yesPayload: unknown = await yesResponse.json();
  const savedYes = putResponseSuccessSchema.parse(yesPayload);
  expect(savedYes.value).toBe("YES");
  expect(savedYes.revision).toBeGreaterThan(joinRevision);
  const yesRevision = savedYes.revision;
  await expect(guestYes).toBeChecked();
  await expect(
    guestResponseGroup.locator(`[data-save-status="${optionId}"]`),
  ).toHaveText("Saved");

  await ownerPage.goto(created.publicUrl);
  await expect(ownerPage).toHaveURL(created.publicUrl);
  await expect(ownerPage.getByRole("heading", {
    level: 1,
    name: TITLE,
    exact: true,
  })).toBeVisible();
  const twoYesOwnerSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  assertActiveAppointment(twoYesOwnerSnapshot, created.publicId, yesRevision);
  expect(twoYesOwnerSnapshot.viewer.kind).toBe("authenticated");
  expect(twoYesOwnerSnapshot.viewer.activeParticipantId).toBe(
    ownerParticipantId,
  );
  assertParticipants(
    twoYesOwnerSnapshot,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  assertOptionGraph(
    twoYesOwnerSnapshot,
    optionId,
    ownerParticipantId,
    guestParticipantId,
    "YES",
    true,
  );

  const ownerDeleteControl = ownerPage.locator(
    `[data-delete-option="${optionId}"]`,
  );
  await expect(ownerDeleteControl).toHaveCount(1);
  await expect(ownerDeleteControl).toHaveRole("button");
  await expect(ownerDeleteControl).toHaveText("Delete");
  await expect(ownerDeleteControl).toHaveAccessibleName("Delete an option");
  const deletePath =
    `/api/appointments/${created.publicId}/options/${optionId}`;
  const firstDeleteResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "DELETE",
    deletePath,
  );
  await ownerDeleteControl.click();
  const firstDeleteResponse = await firstDeleteResponsePromise;
  expect(firstDeleteResponse.status()).toBe(409);
  expect(deleteOptionRequestSchema.parse(
    firstDeleteResponse.request().postDataJSON(),
  )).toEqual({ participantId: ownerParticipantId });
  const firstDeletePayload: unknown = await firstDeleteResponse.json();
  const initialConfirmation =
    appointmentRouteContracts.deleteOption.errors.bodySchema.parse(
      firstDeletePayload,
    );
  expect(initialConfirmation.error.code).toBe("DELETE_CONFIRMATION_REQUIRED");
  if (initialConfirmation.error.code !== "DELETE_CONFIRMATION_REQUIRED") {
    throw new Error("The first deletion did not require confirmation");
  }
  const firstToken = initialConfirmation.error.details.token;
  expect(initialConfirmation).toEqual({
    error: {
      code: "DELETE_CONFIRMATION_REQUIRED",
      message: CONFIRMATION_MESSAGE,
      details: {
        count: 2,
        names: initialConfirmation.error.details.names,
        token: firstToken,
      },
    },
  });
  expect([...initialConfirmation.error.details.names].sort()).toEqual(
    [OWNER_NAME, guestName].sort(),
  );

  const dialog = ownerPage.getByRole("dialog", {
    name: `Delete ${DATE_LABEL}?`,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const dialogElement = await dialog.elementHandle();
  if (dialogElement === null) {
    throw new Error("The deletion confirmation dialog was not mounted");
  }
  const initialParticipantRows = dialog.locator("[data-delete-participant]");
  await expect(initialParticipantRows).toHaveCount(2);
  await expect(initialParticipantRows).toHaveText(
    initialConfirmation.error.details.names,
  );
  await expect(dialog.getByText(OWNER_NAME, { exact: true })).toHaveCount(1);
  await expect(dialog.getByText(guestName, { exact: true })).toHaveCount(1);

  const guestNo = guestResponseGroup.getByRole("radio", {
    name: "No",
    exact: true,
  });
  const noResponsePromise = waitForExactRouteResponse(
    page,
    "PUT",
    responsePath,
  );
  await guestNo.check();
  const noResponse = await noResponsePromise;
  expect(noResponse.status()).toBe(200);
  expect(putResponseRequestSchema.parse(
    noResponse.request().postDataJSON(),
  )).toEqual({ participantId: guestParticipantId, value: "NO" });
  const noPayload: unknown = await noResponse.json();
  const savedNo = putResponseSuccessSchema.parse(noPayload);
  expect(savedNo.value).toBe("NO");
  expect(savedNo.revision).toBeGreaterThan(yesRevision);
  const noRevision = savedNo.revision;
  await expect(guestNo).toBeChecked();
  const guestLedger = page.getByRole("table", {
    name: "Participant availability by appointment option",
    exact: true,
  });
  const guestLedgerRow = guestLedger.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: DATE_LABEL, exact: true }),
  });
  await expect(guestLedgerRow).toHaveCount(1);
  const guestOwnCell = guestLedgerRow.locator(
    `[data-option-id="${optionId}"][data-participant-id="${guestParticipantId}"]`,
  );
  await expect(guestOwnCell).toHaveCount(1);
  await expect(
    guestOwnCell.getByRole("radio", { name: "No", exact: true }),
  ).toBeChecked();
  await expect(
    guestResponseGroup.locator(`[data-save-status="${optionId}"]`),
  ).toHaveText("Saved");
  await expect(dialog).toBeVisible();
  await expect(initialParticipantRows).toHaveText(
    initialConfirmation.error.details.names,
  );

  const confirmDelete = dialog.getByRole("button", {
    name: "Delete option",
    exact: true,
  });
  const staleDeleteResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "DELETE",
    deletePath,
  );
  await confirmDelete.click();
  const staleDeleteResponse = await staleDeleteResponsePromise;
  expect(staleDeleteResponse.status()).toBe(409);
  expect(deleteOptionRequestSchema.parse(
    staleDeleteResponse.request().postDataJSON(),
  )).toEqual({
    participantId: ownerParticipantId,
    confirmationToken: firstToken,
  });
  const staleDeletePayload: unknown = await staleDeleteResponse.json();
  const staleConfirmation =
    appointmentRouteContracts.deleteOption.errors.bodySchema.parse(
      staleDeletePayload,
    );
  expect(staleConfirmation.error.code).toBe("STALE_DELETE_CONFIRMATION");
  if (staleConfirmation.error.code !== "STALE_DELETE_CONFIRMATION") {
    throw new Error("The old token did not return a stale confirmation");
  }
  const replacementToken = staleConfirmation.error.details.token;
  expect(replacementToken).not.toBe(firstToken);
  expect(staleConfirmation).toEqual({
    error: {
      code: "STALE_DELETE_CONFIRMATION",
      message: STALE_MESSAGE,
      details: {
        count: 1,
        names: [OWNER_NAME],
        token: replacementToken,
      },
    },
  });

  const staleStatus = ownerPage.getByRole("status").filter({
    hasText: STALE_NOTICE,
  });
  await expect(staleStatus).toHaveCount(1);
  await expect(staleStatus).toHaveText(STALE_NOTICE);
  await expect(
    ownerPage.locator("dialog[data-delete-dialog]"),
  ).toHaveCount(1);
  const soleStaleDialog = ownerPage.getByRole("dialog", {
    name: `Delete ${DATE_LABEL}?`,
    exact: true,
  }).filter({ has: staleStatus });
  await expect(soleStaleDialog).toHaveCount(1);
  expect(await dialogElement.evaluate((element) => ({
    connected: element.isConnected,
    open: (element as HTMLDialogElement).open,
  }))).toEqual({ connected: true, open: true });
  const refreshedParticipantRows = soleStaleDialog.locator(
    "[data-delete-participant]",
  );
  await expect(refreshedParticipantRows).toHaveCount(1);
  await expect(refreshedParticipantRows).toHaveText([OWNER_NAME]);
  await expect(
    soleStaleDialog.getByText(guestName, { exact: true }),
  ).toHaveCount(0);
  await expect(ownerPage.getByRole("group", {
    name: DATE_LABEL,
    exact: true,
  })).toHaveCount(1);
  await expect(ownerDeleteControl).toHaveCount(1);

  const [ownerBeforeDeletion, guestBeforeDeletion] = await Promise.all([
    readAppointmentSnapshot(ownerPage, created.publicId),
    readAppointmentSnapshot(page, created.publicId),
  ]);
  assertActiveAppointment(ownerBeforeDeletion, created.publicId, noRevision);
  expect(ownerBeforeDeletion.viewer.kind).toBe("authenticated");
  expect(ownerBeforeDeletion.viewer.activeParticipantId).toBe(
    ownerParticipantId,
  );
  assertParticipants(
    ownerBeforeDeletion,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  assertOptionGraph(
    ownerBeforeDeletion,
    optionId,
    ownerParticipantId,
    guestParticipantId,
    "NO",
    true,
  );

  assertActiveAppointment(guestBeforeDeletion, created.publicId, noRevision);
  expect(guestBeforeDeletion.viewer.kind).toBe("guest");
  expect(guestBeforeDeletion.viewer.activeParticipantId).toBe(
    guestParticipantId,
  );
  assertParticipants(
    guestBeforeDeletion,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  assertOptionGraph(
    guestBeforeDeletion,
    optionId,
    ownerParticipantId,
    guestParticipantId,
    "NO",
    false,
  );
  await expect(ownerDeleteControl).toHaveCount(1);

  const finalDeleteResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "DELETE",
    deletePath,
  );
  await confirmDelete.click();
  const finalDeleteResponse = await finalDeleteResponsePromise;
  expect(finalDeleteResponse.status()).toBe(200);
  expect(deleteOptionRequestSchema.parse(
    finalDeleteResponse.request().postDataJSON(),
  )).toEqual({
    participantId: ownerParticipantId,
    confirmationToken: replacementToken,
  });
  const finalDeletePayload: unknown = await finalDeleteResponse.json();
  const deleted = revisionSuccessSchema.parse(finalDeletePayload);
  expect(deleted.revision).toBeGreaterThan(noRevision);

  await expect(dialog).toHaveCount(0);
  await expect(ownerPage.getByRole("group", {
    name: DATE_LABEL,
    exact: true,
  })).toHaveCount(0);
  await expect(ownerDeleteControl).toHaveCount(0);

  const finalOwnerSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  assertActiveAppointment(
    finalOwnerSnapshot,
    created.publicId,
    deleted.revision,
  );
  expect(finalOwnerSnapshot.viewer.kind).toBe("authenticated");
  expect(finalOwnerSnapshot.viewer.activeParticipantId).toBe(
    ownerParticipantId,
  );
  assertParticipants(
    finalOwnerSnapshot,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  expect(finalOwnerSnapshot.options).toEqual([]);
  expect(finalOwnerSnapshot.options.flatMap((option) => option.responses)).toEqual(
    [],
  );
});
