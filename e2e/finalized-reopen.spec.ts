import type { Page, Response } from "@playwright/test";

import {
  addOptionRequestSchema,
  addOptionSuccessSchema,
  appointmentRouteContracts,
  finalizeRequestSchema,
  joinParticipantRequestSchema,
  joinParticipantSuccessSchema,
  putResponseRequestSchema,
  putResponseSuccessSchema,
  revisionSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  addSuggestionViaBoard,
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 54 finalized reopen";
const OWNER_NAME = "Task 54 Lifecycle Owner";
const INITIAL_DATE = "2036-09-10";
const INITIAL_DATE_LABEL = "September 10, 2036";
const SUGGESTED_DATE = "2036-09-11";
const SUGGESTED_DATE_LABEL = "September 11, 2036";
const DENIED_DATE = "2036-09-12";
const FINALIZED_NOTICE =
  "Appointment finalized. The selected option is marked below.";
const FINALIZED_CODE = "APPOINTMENT_FINALIZED";
const JOIN_FINALIZED_MESSAGE =
  "Reopen the appointment before adding a participant.";
const RESPONSE_FINALIZED_MESSAGE =
  "Reopen the appointment before changing a response.";
const SUGGESTION_FINALIZED_MESSAGE =
  "Reopen the appointment before adding an option.";
const DELETION_FINALIZED_MESSAGE =
  "Reopen the appointment before deleting an option.";

type RouteMethod = "POST" | "PUT";
type DirectWriteMethod = RouteMethod | "DELETE";
type GuestResponseValue = "YES" | "NO";

interface DirectWriteResult {
  readonly status: number;
  readonly body: unknown;
}

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

async function sendDirectWrite(
  page: Page,
  method: DirectWriteMethod,
  path: string,
  request: object,
): Promise<DirectWriteResult> {
  return page.evaluate(
    async ({ requestMethod, requestPath, requestBody }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body: unknown = await response.json();
      return { status: response.status, body };
    },
    { requestMethod: method, requestPath: path, requestBody: request },
  );
}

function expectAppointmentState(
  snapshot: AppointmentSnapshot,
  publicId: string,
  status: "ACTIVE" | "FINALIZED",
  revision: number,
  finalOptionId: string | null,
): void {
  expect(snapshot.appointment).toEqual({
    publicId,
    title: TITLE,
    description: null,
    type: "DATE",
    status,
    optionLimit: 3,
    finalOptionId,
    revision,
  });
}

function expectParticipants(
  snapshot: AppointmentSnapshot,
  ownerParticipantId: string,
  guestParticipantId: string,
  guestName: string,
): void {
  expect(snapshot.participants).toEqual([
    { id: ownerParticipantId, displayName: OWNER_NAME },
    { id: guestParticipantId, displayName: guestName },
  ]);
}

function expectOptionGraph(
  snapshot: AppointmentSnapshot,
  initialOptionId: string,
  suggestedOptionId: string,
  ownerParticipantId: string,
  guestParticipantId: string,
  guestInitialResponse: GuestResponseValue,
  initialCanDelete: boolean,
  suggestedCanDelete: boolean,
): void {
  expect(snapshot.options).toEqual([
    {
      id: initialOptionId,
      kind: "DATE",
      startDate: INITIAL_DATE,
      creatorParticipantId: ownerParticipantId,
      responses: [
        { participantId: ownerParticipantId, value: "YES" },
        { participantId: guestParticipantId, value: guestInitialResponse },
      ],
      yesCount: guestInitialResponse === "YES" ? 2 : 1,
      noCount: guestInitialResponse === "NO" ? 1 : 0,
      canDelete: initialCanDelete,
    },
    {
      id: suggestedOptionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: guestParticipantId,
      responses: [{ participantId: guestParticipantId, value: "YES" }],
      yesCount: 1,
      noCount: 0,
      canDelete: suggestedCanDelete,
    },
  ]);
}

function optionRow(page: Page, optionLabel: string) {
  return page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: optionLabel, exact: true }),
  });
}

async function expectStatus(
  page: Page,
  status: "Active" | "Finalized",
): Promise<void> {
  const statusSummary = page.getByText("Status", { exact: true }).locator("..");
  await expect(statusSummary.getByText(status, { exact: true })).toBeVisible();
}

async function expectFinalizedReadOnly(
  page: Page,
  initialOptionId: string,
  suggestedOptionId: string,
): Promise<void> {
  const notice = page.getByText(FINALIZED_NOTICE, { exact: true });
  await expect(notice).toHaveAttribute("role", "status");
  await expect(notice).toBeVisible();
  await expectStatus(page, "Finalized");

  const selectedHeader = page.locator(
    `tbody th[data-option-id="${initialOptionId}"]`,
  );
  await expect(selectedHeader).toHaveAttribute("data-selected", "true");
  await expect(
    selectedHeader.getByText("CHOSEN", { exact: true }),
  ).toBeVisible();
  await expect(selectedHeader).toContainText(INITIAL_DATE_LABEL);
  await expect(page.locator(
    `tbody th[data-option-id="${suggestedOptionId}"]`,
  )).not.toHaveAttribute("data-selected", "true");

  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button", {
    name: "＋ Add an option",
    exact: true,
  })).toHaveCount(0);
  await expect(page.getByRole("form", {
    name: "Suggest an option",
    exact: true,
  })).toHaveCount(0);
  await expect(page.locator("[data-delete-option]")).toHaveCount(0);
  await expect(page.getByRole("form", {
    name: "Join appointment",
    exact: true,
  })).toHaveCount(0);
  await expect(page.locator("[data-finalize-form]")).toHaveCount(0);
}

async function expectActiveWithoutSelection(page: Page): Promise<void> {
  await expectStatus(page, "Active");
  await expect(page.getByText(FINALIZED_NOTICE, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
}

test("finalized participant writes are immutable until the owner reopens", async ({
  browser,
  ownerPage,
  page,
}) => {
  // 1. Create through the owner UI and bind the generated owner and option identities.
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: TITLE,
    ownerDisplayName: OWNER_NAME,
    type: "DATE",
    optionLimit: 3,
    candidates: [{ kind: "DATE", startDate: INITIAL_DATE }],
  });
  const initialSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  expectAppointmentState(initialSnapshot, created.publicId, "ACTIVE", 1, null);
  expect(initialSnapshot.viewer.kind).toBe("authenticated");
  const ownerParticipantId = initialSnapshot.viewer.activeParticipantId;
  if (ownerParticipantId === null) {
    throw new Error("The appointment owner did not have an active participant");
  }
  expect(initialSnapshot.participants).toEqual([
    { id: ownerParticipantId, displayName: OWNER_NAME },
  ]);
  expect(initialSnapshot.options).toHaveLength(1);
  const initialOptionId = initialSnapshot.options[0].id;
  expect(initialSnapshot.options[0]).toEqual({
    id: initialOptionId,
    kind: "DATE",
    startDate: INITIAL_DATE,
    creatorParticipantId: ownerParticipantId,
    responses: [{ participantId: ownerParticipantId, value: "YES" }],
    yesCount: 1,
    noCount: 0,
    canDelete: true,
  });

  // 2. Keep the anonymous page loaded while the guest joins, votes, and suggests.
  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  const joinForm = page.getByRole("form", {
    name: "Join appointment",
    exact: true,
  });
  await expect(joinForm).toBeVisible();
  const guestName = `Task 54 Lifecycle Guest ${created.publicId.slice(0, 8)}`;
  await joinForm.getByLabel("Display name", { exact: true }).fill(guestName);
  const participantPath = `/api/appointments/${created.publicId}/participants`;
  const joinResponsePromise = waitForExactRouteResponse(
    page,
    "POST",
    participantPath,
  );
  await joinForm
    .getByRole("button", { name: "Join appointment", exact: true })
    .click();
  const joinResponse = await joinResponsePromise;
  expect(joinResponse.status()).toBe(201);
  const joinRequestPayload: unknown = joinResponse.request().postDataJSON();
  expect(joinParticipantRequestSchema.parse(joinRequestPayload)).toEqual({
    displayName: guestName,
  });
  const joinPayload: unknown = await joinResponse.json();
  const joined = joinParticipantSuccessSchema.parse(joinPayload);
  if (!("editUrl" in joined)) {
    throw new Error("Anonymous guest join did not return a private edit link");
  }
  expect(joined.revision).toBe(2);
  const guestParticipantId = joined.participantId;
  expect(guestParticipantId).not.toBe(ownerParticipantId);

  const initialResponseGroup = page.getByRole("group", {
    name: INITIAL_DATE_LABEL,
    exact: true,
  });
  const initialResponsePath =
    `/api/appointments/${created.publicId}/responses/${initialOptionId}`;
  const yesResponsePromise = waitForExactRouteResponse(
    page,
    "PUT",
    initialResponsePath,
  );
  await initialResponseGroup
    .getByRole("radio", { name: "Yes", exact: true })
    .check();
  const yesResponse = await yesResponsePromise;
  expect(yesResponse.status()).toBe(200);
  const yesRequestPayload: unknown = yesResponse.request().postDataJSON();
  expect(putResponseRequestSchema.parse(yesRequestPayload)).toEqual({
    participantId: guestParticipantId,
    value: "YES",
  });
  const yesPayload: unknown = await yesResponse.json();
  const savedYes = putResponseSuccessSchema.parse(yesPayload);
  expect(savedYes).toEqual({ value: "YES", revision: 3 });
  await expect(
    initialResponseGroup.locator(`[data-save-status="${initialOptionId}"]`),
  ).toHaveText("Saved");

  const addOptionToggle = page.getByRole("button", {
    name: "＋ Add an option",
    exact: true,
  });
  const optionsPath = `/api/appointments/${created.publicId}/options`;
  const suggestionResponsePromise = waitForExactRouteResponse(
    page,
    "POST",
    optionsPath,
  );
  await addSuggestionViaBoard(page, SUGGESTED_DATE);
  const suggestionResponse = await suggestionResponsePromise;
  expect(suggestionResponse.status()).toBe(201);
  const suggestionRequestPayload: unknown =
    suggestionResponse.request().postDataJSON();
  const suggestionRequest = addOptionRequestSchema.parse(
    suggestionRequestPayload,
  );
  expect(suggestionRequest).toEqual({
    participantId: guestParticipantId,
    timeZone: suggestionRequest.timeZone,
    option: { kind: "DATE", startDate: SUGGESTED_DATE },
  });
  const suggestionPayload: unknown = await suggestionResponse.json();
  const added = addOptionSuccessSchema.parse(suggestionPayload);
  expect(added.revision).toBe(4);
  expect(added.optionId).not.toBe(initialOptionId);
  const suggestedOptionId = added.optionId;

  const suggestedResponseGroup = page.getByRole("group", {
    name: SUGGESTED_DATE_LABEL,
    exact: true,
  });
  await expect(
    suggestedResponseGroup.getByRole("radio", { name: "Yes", exact: true }),
  ).toBeChecked();
  const guestAfterSuggestion = await readAppointmentSnapshot(
    page,
    created.publicId,
  );
  expectAppointmentState(
    guestAfterSuggestion,
    created.publicId,
    "ACTIVE",
    added.revision,
    null,
  );
  expect(guestAfterSuggestion.viewer.kind).toBe("guest");
  expect(guestAfterSuggestion.viewer.activeParticipantId).toBe(
    guestParticipantId,
  );
  expectParticipants(
    guestAfterSuggestion,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  expectOptionGraph(
    guestAfterSuggestion,
    initialOptionId,
    suggestedOptionId,
    ownerParticipantId,
    guestParticipantId,
    "YES",
    false,
    true,
  );

  // 3. Load the current owner view and finalize the exact initial option via UI.
  await ownerPage.goto(created.publicUrl);
  await expect(ownerPage).toHaveURL(created.publicUrl);
  const ownerBeforeFinalize = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  expectAppointmentState(
    ownerBeforeFinalize,
    created.publicId,
    "ACTIVE",
    added.revision,
    null,
  );
  expect(ownerBeforeFinalize.viewer.kind).toBe("authenticated");
  expect(ownerBeforeFinalize.viewer.activeParticipantId).toBe(
    ownerParticipantId,
  );
  expectParticipants(
    ownerBeforeFinalize,
    ownerParticipantId,
    guestParticipantId,
    guestName,
  );
  expectOptionGraph(
    ownerBeforeFinalize,
    initialOptionId,
    suggestedOptionId,
    ownerParticipantId,
    guestParticipantId,
    "YES",
    true,
    false,
  );

  const finalizeForm = optionRow(ownerPage, INITIAL_DATE_LABEL).getByRole("form", {
    name: "Finalize appointment",
    exact: true,
  });
  await expect(finalizeForm).toHaveCount(1);
  await expect(ownerPage.locator("[data-finalize-form]")).toHaveCount(2);
  await expect(finalizeForm).toHaveAttribute("data-finalize-form", initialOptionId);
  const finalizePath = `/api/appointments/${created.publicId}/finalize`;
  const finalizeResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "POST",
    finalizePath,
  );
  await finalizeForm
    .getByRole("button", { name: "Finalize", exact: true })
    .click();
  const finalizeResponse = await finalizeResponsePromise;
  expect(finalizeResponse.status()).toBe(200);
  const finalizeRequestPayload: unknown =
    finalizeResponse.request().postDataJSON();
  expect(finalizeRequestSchema.parse(finalizeRequestPayload)).toEqual({
    optionId: initialOptionId,
  });
  const finalizePayload: unknown = await finalizeResponse.json();
  const finalized = revisionSuccessSchema.parse(finalizePayload);
  expect(finalized.revision).toBe(5);

  // 4. Prove all three loaded views are finalized and participant-read-only.
  await expectFinalizedReadOnly(
    ownerPage,
    initialOptionId,
    suggestedOptionId,
  );
  await expectFinalizedReadOnly(page, initialOptionId, suggestedOptionId);
  await expect(ownerPage.getByRole("button", {
    name: "Reopen appointment",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Reopen appointment",
    exact: true,
  })).toHaveCount(0);

  const freshAnonymousContext = await browser.newContext({
    baseURL: E2E_BASE_URL,
  });
  try {
    const freshAnonymousPage = await freshAnonymousContext.newPage();
    await freshAnonymousPage.goto(created.publicUrl);
    await expect(freshAnonymousPage).toHaveURL(created.publicUrl);
    await expectFinalizedReadOnly(
      freshAnonymousPage,
      initialOptionId,
      suggestedOptionId,
    );
    await expect(freshAnonymousPage.getByRole("button", {
      name: "Reopen appointment",
      exact: true,
    })).toHaveCount(0);

    // 5. Send only the four unavailable public writes from their correct actors.
    const deniedGuestName =
      `Task 54 Denied Guest ${created.publicId.slice(0, 8)}`;
    const deniedJoinRequest = joinParticipantRequestSchema.parse({
      displayName: deniedGuestName,
    });
    const deniedJoin = await sendDirectWrite(
      freshAnonymousPage,
      "POST",
      participantPath,
      deniedJoinRequest,
    );
    expect(deniedJoin.status).toBe(409);
    const deniedJoinError =
      appointmentRouteContracts.joinParticipant.errors.bodySchema.parse(
        deniedJoin.body,
      );
    expect(deniedJoinError).toEqual({
      error: {
        code: FINALIZED_CODE,
        message: JOIN_FINALIZED_MESSAGE,
      },
    });

    const deniedResponseRequest = putResponseRequestSchema.parse({
      participantId: guestParticipantId,
      value: "NO",
    });
    const deniedResponse = await sendDirectWrite(
      page,
      "PUT",
      initialResponsePath,
      deniedResponseRequest,
    );
    expect(deniedResponse.status).toBe(409);
    const deniedResponseError =
      appointmentRouteContracts.putResponse.errors.bodySchema.parse(
        deniedResponse.body,
      );
    expect(deniedResponseError).toEqual({
      error: {
        code: FINALIZED_CODE,
        message: RESPONSE_FINALIZED_MESSAGE,
      },
    });

    const deniedSuggestionRequest = addOptionRequestSchema.parse({
      participantId: guestParticipantId,
      timeZone: suggestionRequest.timeZone,
      option: { kind: "DATE", startDate: DENIED_DATE },
    });
    const deniedSuggestion = await sendDirectWrite(
      page,
      "POST",
      optionsPath,
      deniedSuggestionRequest,
    );
    expect(deniedSuggestion.status).toBe(409);
    const deniedSuggestionError =
      appointmentRouteContracts.addOption.errors.bodySchema.parse(
        deniedSuggestion.body,
      );
    expect(deniedSuggestionError).toEqual({
      error: {
        code: FINALIZED_CODE,
        message: SUGGESTION_FINALIZED_MESSAGE,
      },
    });

    const deleteOptionPath =
      `/api/appointments/${created.publicId}/options/${suggestedOptionId}`;
    const deniedDeletionRequest =
      appointmentRouteContracts.deleteOption.request.schema.parse({
        participantId: guestParticipantId,
      });
    const deniedDeletion = await sendDirectWrite(
      page,
      "DELETE",
      deleteOptionPath,
      deniedDeletionRequest,
    );
    expect(deniedDeletion.status).toBe(409);
    const deniedDeletionError =
      appointmentRouteContracts.deleteOption.errors.bodySchema.parse(
        deniedDeletion.body,
      );
    expect(deniedDeletionError).toEqual({
      error: {
        code: FINALIZED_CODE,
        message: DELETION_FINALIZED_MESSAGE,
      },
    });

    // 6. Both actor snapshots retain the exact finalized response graph.
    const [ownerFinalizedSnapshot, guestFinalizedSnapshot] = await Promise.all([
      readAppointmentSnapshot(ownerPage, created.publicId),
      readAppointmentSnapshot(page, created.publicId),
    ]);
    for (const snapshot of [ownerFinalizedSnapshot, guestFinalizedSnapshot]) {
      expectAppointmentState(
        snapshot,
        created.publicId,
        "FINALIZED",
        finalized.revision,
        initialOptionId,
      );
      expectParticipants(
        snapshot,
        ownerParticipantId,
        guestParticipantId,
        guestName,
      );
      expectOptionGraph(
        snapshot,
        initialOptionId,
        suggestedOptionId,
        ownerParticipantId,
        guestParticipantId,
        "YES",
        false,
        false,
      );
    }
    expect(ownerFinalizedSnapshot.viewer.kind).toBe("authenticated");
    expect(guestFinalizedSnapshot.viewer.kind).toBe("guest");
    expect(ownerFinalizedSnapshot.viewer.permissions).toMatchObject({
      canReopen: true,
      canRespond: false,
      canSuggest: false,
    });
    expect(guestFinalizedSnapshot.viewer.permissions).toMatchObject({
      canReopen: false,
      canRespond: false,
      canSuggest: false,
    });
    expect(ownerFinalizedSnapshot.viewer.activeParticipantId).toBe(
      ownerParticipantId,
    );
    expect(guestFinalizedSnapshot.viewer.activeParticipantId).toBe(
      guestParticipantId,
    );

    // 7. Reopen through the owner UI and require the guest controls to return.
    const reopenPath = `/api/appointments/${created.publicId}/reopen`;
    const reopenResponsePromise = waitForExactRouteResponse(
      ownerPage,
      "POST",
      reopenPath,
    );
    await ownerPage.getByRole("button", {
      name: "Reopen appointment",
      exact: true,
    }).click();
    const reopenResponse = await reopenResponsePromise;
    expect(reopenResponse.status()).toBe(200);
    expect(reopenResponse.request().postData()).toBeNull();
    appointmentRouteContracts.reopenAppointment.request.schema.parse(undefined);
    const reopenPayload: unknown = await reopenResponse.json();
    const reopened = revisionSuccessSchema.parse(reopenPayload);
    expect(reopened.revision).toBe(6);
    expect(reopened.revision).toBeGreaterThan(finalized.revision);

    await expectActiveWithoutSelection(ownerPage);
    await expectActiveWithoutSelection(page);
    await expect(ownerPage.locator("[data-finalize-form]")).toHaveCount(2);
    await expect(
      optionRow(ownerPage, INITIAL_DATE_LABEL)
        .getByRole("button", { name: "Finalize", exact: true }),
    ).toBeVisible();
    await expect(initialResponseGroup.getByRole("radio")).toHaveCount(3);
    await expect(
      initialResponseGroup.getByRole("radio", { name: "Yes", exact: true }),
    ).toBeChecked();
    await expect(addOptionToggle).toBeVisible();
    const restoredDeleteControl = page.locator(
      `[data-delete-option="${suggestedOptionId}"]`,
    );
    await expect(restoredDeleteControl).toHaveCount(1);
    await expect(restoredDeleteControl).toBeVisible();

    // 8. Save guest No through the restored radio, then prove both final snapshots.
    const noResponsePromise = waitForExactRouteResponse(
      page,
      "PUT",
      initialResponsePath,
    );
    const noRadio = initialResponseGroup.getByRole("radio", {
      name: "No",
      exact: true,
    });
    await noRadio.check();
    const noResponse = await noResponsePromise;
    expect(noResponse.status()).toBe(200);
    const noRequestPayload: unknown = noResponse.request().postDataJSON();
    expect(putResponseRequestSchema.parse(noRequestPayload)).toEqual({
      participantId: guestParticipantId,
      value: "NO",
    });
    const noPayload: unknown = await noResponse.json();
    const savedNo = putResponseSuccessSchema.parse(noPayload);
    expect(savedNo).toEqual({ value: "NO", revision: 7 });
    expect(savedNo.revision).toBeGreaterThan(reopened.revision);
    await expect(noRadio).toBeChecked();

    const guestLedger = page.getByRole("table", {
      name: "Participant availability by appointment option",
      exact: true,
    });
    const guestLedgerRow = guestLedger.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: INITIAL_DATE_LABEL, exact: true }),
    });
    await expect(guestLedgerRow).toHaveCount(1);
    // The guest is the viewer: their own answer is the you-cell of that row.
    await expect(guestLedgerRow.locator(
      `[data-option-id="${initialOptionId}"]`
      + `[data-participant-id="${guestParticipantId}"]`,
    ).getByRole("radio", { name: "No", exact: true })).toBeChecked();
    // The owner sees the same answer as a named mark in the guest's column.
    await expect(ownerPage.getByRole("row").filter({
      has: ownerPage.getByRole("rowheader", {
        name: INITIAL_DATE_LABEL,
        exact: true,
      }),
    }).locator(
      `[data-option-id="${initialOptionId}"]`
      + `[data-participant-id="${guestParticipantId}"] [role="img"]`,
    )).toHaveAttribute("aria-label", `${guestName}: No`);
    await expect(
      initialResponseGroup.locator(`[data-save-status="${initialOptionId}"]`),
    ).toHaveText("Saved");

    const [finalOwnerSnapshot, finalGuestSnapshot] = await Promise.all([
      readAppointmentSnapshot(ownerPage, created.publicId),
      readAppointmentSnapshot(page, created.publicId),
    ]);
    expectAppointmentState(
      finalOwnerSnapshot,
      created.publicId,
      "ACTIVE",
      savedNo.revision,
      null,
    );
    expectAppointmentState(
      finalGuestSnapshot,
      created.publicId,
      "ACTIVE",
      savedNo.revision,
      null,
    );
    expectParticipants(
      finalOwnerSnapshot,
      ownerParticipantId,
      guestParticipantId,
      guestName,
    );
    expectParticipants(
      finalGuestSnapshot,
      ownerParticipantId,
      guestParticipantId,
      guestName,
    );
    expect(finalOwnerSnapshot.viewer.kind).toBe("authenticated");
    expect(finalGuestSnapshot.viewer.kind).toBe("guest");
    expect(finalOwnerSnapshot.viewer.permissions).toMatchObject({
      canFinalize: true,
      canRespond: true,
      canSuggest: true,
    });
    expect(finalGuestSnapshot.viewer.permissions).toMatchObject({
      canFinalize: false,
      canRespond: true,
      canSuggest: true,
    });
    expect(finalOwnerSnapshot.viewer.activeParticipantId).toBe(
      ownerParticipantId,
    );
    expect(finalGuestSnapshot.viewer.activeParticipantId).toBe(
      guestParticipantId,
    );
    expectOptionGraph(
      finalOwnerSnapshot,
      initialOptionId,
      suggestedOptionId,
      ownerParticipantId,
      guestParticipantId,
      "NO",
      true,
      false,
    );
    expectOptionGraph(
      finalGuestSnapshot,
      initialOptionId,
      suggestedOptionId,
      ownerParticipantId,
      guestParticipantId,
      "NO",
      false,
      true,
    );
  } finally {
    await freshAnonymousContext.close();
  }
});
