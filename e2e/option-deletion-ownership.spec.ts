import type { Page, Response } from "@playwright/test";

import {
  addOptionSuccessSchema,
  appointmentRouteContracts,
  createAppointmentSuccessSchema,
  joinParticipantSuccessSchema,
} from "../src/features/appointments/contracts";
import {
  addSuggestionViaBoard,
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 52 option deletion ownership";
const INITIAL_DATE = "2034-07-20";
const INITIAL_DATE_LABEL = "July 20, 2034";
const SUGGESTED_DATE = "2034-07-21";
const SUGGESTED_DATE_LABEL = "July 21, 2034";
const OWNERSHIP_MESSAGE =
  "Only the participant who suggested this option can delete it.";

interface BrowserDeleteResult {
  readonly status: number;
  readonly body: unknown;
}

function waitForExactPost(page: Page, path: string): Promise<Response> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === "POST"
  ));
}

async function deleteOptionAsCurrentActor(
  page: Page,
  path: string,
  participantId: string,
): Promise<BrowserDeleteResult> {
  return page.evaluate(async ({ deletePath, actorParticipantId }) => {
    const response = await fetch(deletePath, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: actorParticipantId }),
    });
    const body: unknown = await response.json();
    return { status: response.status, body };
  }, { deletePath: path, actorParticipantId: participantId });
}

test("only a suggested option's creator can delete it", async ({
  browser,
  ownerPage,
  page,
}) => {
  const createResponsePromise = waitForExactPost(
    ownerPage,
    "/api/appointments",
  );
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: TITLE,
    type: "DATE",
    optionLimit: 2,
    candidates: [{ kind: "DATE", startDate: INITIAL_DATE }],
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
  expect(initialSnapshot.appointment).toEqual({
    publicId: created.publicId,
    title: TITLE,
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 2,
    finalOptionId: null,
    revision: 1,
  });
  expect(initialSnapshot.viewer.kind).toBe("authenticated");
  const ownerParticipantId = initialSnapshot.viewer.activeParticipantId;
  expect(ownerParticipantId).not.toBeNull();
  if (ownerParticipantId === null) {
    throw new Error("The appointment owner did not have an active participant");
  }
  expect(initialSnapshot.options).toHaveLength(1);
  const initialOption = initialSnapshot.options[0];
  if (initialOption === undefined || initialOption.kind !== "DATE") {
    throw new Error("Creation did not return the expected DATE option");
  }
  const initialOptionId = initialOption.id;
  const initialRevision = initialSnapshot.appointment.revision;
  expect(initialOption).toEqual({
    id: initialOptionId,
    kind: "DATE",
    startDate: INITIAL_DATE,
    creatorParticipantId: ownerParticipantId,
    responses: [{ participantId: ownerParticipantId, value: "YES" }],
    yesCount: 1,
    noCount: 0,
    canDelete: true,
  });

  await ownerPage.goto(created.publicUrl);
  await expect(ownerPage).toHaveURL(created.publicUrl);
  await expect(ownerPage.getByRole("heading", {
    level: 1,
    name: TITLE,
    exact: true,
  })).toBeVisible();

  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(created.publicUrl);
  const participantAJoinForm = page.getByRole("form", {
    name: "Join appointment",
    exact: true,
  });
  await expect(participantAJoinForm).toBeVisible();
  const participantAName = `Task 52 Participant A ${created.publicId.slice(0, 8)}`;
  await participantAJoinForm
    .getByLabel("Display name", { exact: true })
    .fill(participantAName);
  const participantsPath = `/api/appointments/${created.publicId}/participants`;
  const participantAJoinPromise = waitForExactPost(page, participantsPath);
  await participantAJoinForm
    .getByRole("button", { name: "Join appointment", exact: true })
    .click();
  const participantAJoinResponse = await participantAJoinPromise;
  expect(participantAJoinResponse.status()).toBe(201);
  const participantAJoinPayload: unknown = await participantAJoinResponse.json();
  const participantAJoin = joinParticipantSuccessSchema.parse(
    participantAJoinPayload,
  );
  if (!("editUrl" in participantAJoin)) {
    throw new Error("Participant A did not receive a private edit link");
  }
  expect(participantAJoin.revision).toBeGreaterThan(initialRevision);
  const participantAId = participantAJoin.participantId;
  expect(participantAId).not.toBe(ownerParticipantId);

  await expect(page.getByRole("group", {
    name: INITIAL_DATE_LABEL,
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Add an option",
    exact: true,
  })).toBeVisible();
  const optionsPath = `/api/appointments/${created.publicId}/options`;
  const addOptionPromise = waitForExactPost(page, optionsPath);
  await addSuggestionViaBoard(page, SUGGESTED_DATE);
  const addOptionResponse = await addOptionPromise;
  expect(addOptionResponse.status()).toBe(201);
  const addOptionPayload: unknown = await addOptionResponse.json();
  const addedOption = addOptionSuccessSchema.parse(addOptionPayload);
  expect(addedOption.optionId).not.toBe(initialOptionId);
  expect(addedOption.revision).toBeGreaterThan(participantAJoin.revision);
  const suggestedOptionId = addedOption.optionId;

  const participantASuggestedResponse = page.getByRole("group", {
    name: SUGGESTED_DATE_LABEL,
    exact: true,
  });
  await expect(participantASuggestedResponse).toBeVisible();
  await expect(participantASuggestedResponse.getByRole("radio", {
    name: "Yes",
    exact: true,
  })).toBeChecked();
  const participantADeleteButtons = page.getByRole("button", {
    name: "Delete an option",
    exact: true,
  });
  await expect(participantADeleteButtons).toHaveCount(1);
  await expect(participantADeleteButtons).toBeVisible();
  await expect(participantADeleteButtons).toHaveAttribute(
    "data-delete-option",
    suggestedOptionId,
  );
  // The trigger describes itself by its own option row, never by another.
  await expect(participantADeleteButtons).toHaveAttribute(
    "aria-describedby",
    `option-label-${suggestedOptionId}`,
  );
  await expect(page.locator(`[data-delete-option="${initialOptionId}"]`))
    .toHaveCount(0);

  const participantASnapshot = await readAppointmentSnapshot(
    page,
    created.publicId,
  );
  expect(participantASnapshot.appointment.revision).toBe(
    addedOption.revision,
  );
  expect(participantASnapshot.viewer.activeParticipantId).toBe(participantAId);
  expect(
    participantASnapshot.participants.filter(({ id }) => id === participantAId),
  ).toEqual([{ id: participantAId, displayName: participantAName }]);
  expect(participantASnapshot.options.map(({ id }) => id)).toEqual([
    initialOptionId,
    suggestedOptionId,
  ]);
  const participantASuggestedOption = participantASnapshot.options.find(
    ({ id }) => id === suggestedOptionId,
  );
  expect(participantASuggestedOption).toEqual({
    id: suggestedOptionId,
    kind: "DATE",
    startDate: SUGGESTED_DATE,
    creatorParticipantId: participantAId,
    responses: [{ participantId: participantAId, value: "YES" }],
    yesCount: 1,
    noCount: 0,
    canDelete: true,
  });

  const participantBContext = await browser.newContext({
    baseURL: E2E_BASE_URL,
  });
  try {
    const participantBPage = await participantBContext.newPage();
    await participantBPage.goto(created.publicUrl);
    await expect(participantBPage).toHaveURL(created.publicUrl);
    const participantBJoinForm = participantBPage.getByRole("form", {
      name: "Join appointment",
      exact: true,
    });
    await expect(participantBJoinForm).toBeVisible();
    const participantBName = `Task 52 Participant B ${created.publicId.slice(0, 8)}`;
    await participantBJoinForm
      .getByLabel("Display name", { exact: true })
      .fill(participantBName);
    const participantBJoinPromise = waitForExactPost(
      participantBPage,
      participantsPath,
    );
    await participantBJoinForm
      .getByRole("button", { name: "Join appointment", exact: true })
      .click();
    const participantBJoinResponse = await participantBJoinPromise;
    expect(participantBJoinResponse.status()).toBe(201);
    const participantBJoinPayload: unknown = await participantBJoinResponse.json();
    const participantBJoin = joinParticipantSuccessSchema.parse(
      participantBJoinPayload,
    );
    if (!("editUrl" in participantBJoin)) {
      throw new Error("Participant B did not receive a private edit link");
    }
    expect(participantBJoin.revision).toBeGreaterThan(addedOption.revision);
    const participantBId = participantBJoin.participantId;
    expect(participantBId).not.toBe(ownerParticipantId);
    expect(participantBId).not.toBe(participantAId);

    await expect(participantBPage.getByRole("group", {
      name: SUGGESTED_DATE_LABEL,
      exact: true,
    })).toBeVisible();
    await expect(participantBPage.locator(
      `[data-delete-option="${suggestedOptionId}"]`,
    )).toHaveCount(0);
    const participantBSnapshot = await readAppointmentSnapshot(
      participantBPage,
      created.publicId,
    );
    expect(participantBSnapshot.appointment.revision).toBe(
      participantBJoin.revision,
    );
    expect(participantBSnapshot.viewer.activeParticipantId).toBe(participantBId);
    expect(
      participantBSnapshot.participants.filter(({ id }) => id === participantBId),
    ).toEqual([{ id: participantBId, displayName: participantBName }]);
    expect(participantBSnapshot.options.map(({ id }) => id)).toEqual([
      initialOptionId,
      suggestedOptionId,
    ]);
    expect(participantBSnapshot.options.find(
      ({ id }) => id === suggestedOptionId,
    )).toEqual({
      id: suggestedOptionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: participantAId,
      responses: [{ participantId: participantAId, value: "YES" }],
      yesCount: 1,
      noCount: 0,
      canDelete: false,
    });

    const deleteOptionPath =
      `/api/appointments/${created.publicId}/options/${suggestedOptionId}`;
    const participantBDelete = await deleteOptionAsCurrentActor(
      participantBPage,
      deleteOptionPath,
      participantBId,
    );
    expect(participantBDelete.status).toBe(403);
    expect(
      appointmentRouteContracts.deleteOption.errors.bodySchema.parse(
        participantBDelete.body,
      ),
    ).toEqual({
      error: { code: "FORBIDDEN", message: OWNERSHIP_MESSAGE },
    });

    await ownerPage.reload();
    await expect(ownerPage).toHaveURL(created.publicUrl);
    await expect(ownerPage.getByRole("heading", {
      level: 1,
      name: TITLE,
      exact: true,
    })).toBeVisible();
    await expect(ownerPage.locator(
      `[data-delete-option="${suggestedOptionId}"]`,
    )).toHaveCount(0);
    await expect(ownerPage.locator(
      `[data-delete-option="${initialOptionId}"]`,
    )).toHaveCount(1);

    const currentOwnerSnapshot = await readAppointmentSnapshot(
      ownerPage,
      created.publicId,
    );
    expect(currentOwnerSnapshot.appointment.revision).toBe(
      participantBJoin.revision,
    );
    expect(currentOwnerSnapshot.viewer.kind).toBe("authenticated");
    expect(currentOwnerSnapshot.viewer.activeParticipantId).toBe(
      ownerParticipantId,
    );
    expect(currentOwnerSnapshot.options.find(
      ({ id }) => id === suggestedOptionId,
    )).toEqual({
      id: suggestedOptionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: participantAId,
      responses: [{ participantId: participantAId, value: "YES" }],
      yesCount: 1,
      noCount: 0,
      canDelete: false,
    });

    const ownerDelete = await deleteOptionAsCurrentActor(
      ownerPage,
      deleteOptionPath,
      ownerParticipantId,
    );
    expect(ownerDelete.status).toBe(403);
    expect(
      appointmentRouteContracts.deleteOption.errors.bodySchema.parse(
        ownerDelete.body,
      ),
    ).toEqual({
      error: { code: "FORBIDDEN", message: OWNERSHIP_MESSAGE },
    });

    const finalOwnerSnapshot = await readAppointmentSnapshot(
      ownerPage,
      created.publicId,
    );
    expect(finalOwnerSnapshot.appointment).toEqual({
      publicId: created.publicId,
      title: TITLE,
      description: null,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 2,
      finalOptionId: null,
      revision: participantBJoin.revision,
    });
    expect(finalOwnerSnapshot.viewer.activeParticipantId).toBe(
      ownerParticipantId,
    );
    expect(finalOwnerSnapshot.options).toEqual([
      {
        id: initialOptionId,
        kind: "DATE",
        startDate: INITIAL_DATE,
        creatorParticipantId: ownerParticipantId,
        responses: [{ participantId: ownerParticipantId, value: "YES" }],
        yesCount: 1,
        noCount: 0,
        canDelete: true,
      },
      {
        id: suggestedOptionId,
        kind: "DATE",
        startDate: SUGGESTED_DATE,
        creatorParticipantId: participantAId,
        responses: [{ participantId: participantAId, value: "YES" }],
        yesCount: 1,
        noCount: 0,
        canDelete: false,
      },
    ]);
    expect(
      finalOwnerSnapshot.participants.filter(({ id }) => id === participantAId),
    ).toEqual([{ id: participantAId, displayName: participantAName }]);
    expect(
      finalOwnerSnapshot.participants.filter(({ id }) => id === participantBId),
    ).toEqual([{ id: participantBId, displayName: participantBName }]);

    await page.reload();
    await expect(page).toHaveURL(created.publicUrl);
    await expect(page.getByRole("heading", {
      level: 1,
      name: TITLE,
      exact: true,
    })).toBeVisible();
    const refreshedParticipantADelete = page.locator(
      `[data-delete-option="${suggestedOptionId}"]`,
    );
    await expect(refreshedParticipantADelete).toHaveCount(1);
    await expect(refreshedParticipantADelete).toHaveRole("button");
    await expect(page.locator(
      `[data-delete-option="${initialOptionId}"]`,
    )).toHaveCount(0);

    const finalParticipantASnapshot = await readAppointmentSnapshot(
      page,
      created.publicId,
    );
    expect(finalParticipantASnapshot.appointment.revision).toBe(
      participantBJoin.revision,
    );
    expect(finalParticipantASnapshot.viewer.activeParticipantId).toBe(
      participantAId,
    );
    expect(finalParticipantASnapshot.options.map(({ id }) => id)).toEqual([
      initialOptionId,
      suggestedOptionId,
    ]);
    expect(finalParticipantASnapshot.options.find(
      ({ id }) => id === suggestedOptionId,
    )).toEqual({
      id: suggestedOptionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: participantAId,
      responses: [{ participantId: participantAId, value: "YES" }],
      yesCount: 1,
      noCount: 0,
      canDelete: true,
    });
  } finally {
    await participantBContext.close();
  }
});
