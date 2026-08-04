import type { Frame, Page, Request, Response } from "@playwright/test";

import {
  addOptionSuccessSchema,
  appointmentSnapshotSchema,
  joinParticipantSuccessSchema,
  putResponseSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  addSuggestionViaBoard,
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 50 cross-context SSE";
const INITIAL_DATE = "2032-06-17";
const INITIAL_DATE_LABEL = "June 17, 2032";
const SUGGESTED_DATE = "2032-06-18";
const SUGGESTED_DATE_LABEL = "June 18, 2032";

type RouteMethod = "GET" | "POST" | "PUT";
type SnapshotPredicate = (snapshot: AppointmentSnapshot) => boolean;

interface MatchingSnapshotResponse {
  readonly response: Response;
  readonly snapshot: AppointmentSnapshot;
}

function exactRouteUrl(path: string): string {
  return new URL(path, E2E_BASE_URL).href;
}

function waitForExactRouteResponse(
  page: Page,
  method: RouteMethod,
  path: string,
): Promise<Response> {
  const expectedUrl = exactRouteUrl(path);
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

async function waitForMatchingAppointmentSnapshot(
  page: Page,
  path: string,
  predicate: SnapshotPredicate,
): Promise<MatchingSnapshotResponse> {
  const expectedUrl = exactRouteUrl(path);
  const response = await page.waitForResponse(async (candidate) => {
    if (
      candidate.url() !== expectedUrl
      || candidate.request().method() !== "GET"
      || candidate.status() !== 200
    ) {
      return false;
    }

    const payload: unknown = await candidate.json();
    return predicate(appointmentSnapshotSchema.parse(payload));
  });
  const payload: unknown = await response.json();
  return {
    response,
    snapshot: appointmentSnapshotSchema.parse(payload),
  };
}

test("an owner receives a guest vote and suggestion through SSE without reloading", async ({
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
  const ownerParticipantId = initialSnapshot.viewer.activeParticipantId;
  expect(ownerParticipantId).not.toBeNull();
  if (ownerParticipantId === null) {
    throw new Error("The appointment owner did not have an active participant");
  }
  expect(initialSnapshot.viewer.kind).toBe("authenticated");

  const eventsPath = `/api/appointments/${created.publicId}/events`;
  const eventsUrl = exactRouteUrl(eventsPath);
  const ownerSnapshotPath = `/api/appointments/${created.publicId}/snapshot?participantId=${encodeURIComponent(ownerParticipantId)}`;
  const eventRequestPromise = ownerPage.waitForRequest((request) => (
    request.url() === eventsUrl
    && request.method() === "GET"
    && request.resourceType() === "eventsource"
  ));
  const eventResponsePromise = waitForExactRouteResponse(
    ownerPage,
    "GET",
    eventsPath,
  );
  const initialRepairPromise = waitForMatchingAppointmentSnapshot(
    ownerPage,
    ownerSnapshotPath,
    (snapshot) => (
      snapshot.appointment.publicId === created.publicId
      && snapshot.appointment.revision === initialRevision
      && snapshot.viewer.activeParticipantId === ownerParticipantId
    ),
  );

  await ownerPage.goto(created.publicUrl);
  const [eventRequest, eventResponse, initialRepair] = await Promise.all([
    eventRequestPromise,
    eventResponsePromise,
    initialRepairPromise,
  ]);
  expect(eventRequest.url()).toBe(eventsUrl);
  expect(eventRequest.resourceType()).toBe("eventsource");
  expect(eventRequest.isNavigationRequest()).toBe(false);
  expect(eventResponse.status()).toBe(200);
  expect(eventResponse.headers()["content-type"]).toBe(
    "text/event-stream; charset=utf-8",
  );
  expect(initialRepair.response.status()).toBe(200);
  expect(initialRepair.snapshot.appointment.revision).toBe(initialRevision);
  await expect(ownerPage).toHaveURL(created.publicUrl);
  await expect(
    ownerPage.getByRole("heading", { level: 1, name: TITLE, exact: true }),
  ).toBeVisible();

  const observedMainFrameNavigations: string[] = [];
  const observedDocumentRequests: string[] = [];
  const observeFrameNavigation = (frame: Frame): void => {
    if (frame === ownerPage.mainFrame()) {
      observedMainFrameNavigations.push(frame.url());
    }
  };
  const observeRequest = (request: Request): void => {
    if (request.resourceType() === "document") {
      observedDocumentRequests.push(request.url());
    }
  };
  ownerPage.on("framenavigated", observeFrameNavigation);
  ownerPage.on("request", observeRequest);

  try {
    await page.goto(created.publicUrl);
    await expect(page).toHaveURL(created.publicUrl);
    const joinForm = page.getByRole("form", {
      name: "Join appointment",
      exact: true,
    });
    await expect(joinForm).toBeVisible();

    const guestName = `Task 50 SSE Guest ${created.publicId.slice(0, 8)}`;
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
    const addOptionToggle = page.getByRole("button", {
      name: "Add an option",
      exact: true,
    });
    await expect(initialResponseGroup).toBeVisible();
    await expect(addOptionToggle).toBeVisible();

    const ownerVoteSnapshotPromise = waitForMatchingAppointmentSnapshot(
      ownerPage,
      ownerSnapshotPath,
      (snapshot) => (
        snapshot.appointment.publicId === created.publicId
        && snapshot.appointment.revision > joined.revision
        && snapshot.viewer.activeParticipantId === ownerParticipantId
        && snapshot.participants.some((participant) => (
          participant.id === guestParticipantId
          && participant.displayName === guestName
        ))
        && snapshot.options.some((option) => (
          option.id === initialOptionId
          && option.responses.some((response) => (
            response.participantId === guestParticipantId
            && response.value === "YES"
          ))
        ))
      ),
    );
    const responsePath = `/api/appointments/${created.publicId}/responses/${initialOptionId}`;
    const putResponsePromise = waitForExactRouteResponse(
      page,
      "PUT",
      responsePath,
    );
    await initialResponseGroup
      .getByRole("radio", { name: "Yes", exact: true })
      .check();

    const putResponse = await putResponsePromise;
    expect(putResponse.status()).toBe(200);
    const putPayload: unknown = await putResponse.json();
    const savedResponse = putResponseSuccessSchema.parse(putPayload);
    expect(savedResponse.value).toBe("YES");
    expect(savedResponse.revision).toBeGreaterThan(joined.revision);

    const ownerVoteRefresh = await ownerVoteSnapshotPromise;
    expect(ownerVoteRefresh.response.status()).toBe(200);
    expect(ownerVoteRefresh.snapshot.appointment.revision).toBeGreaterThanOrEqual(
      savedResponse.revision,
    );

    const ownerLedger = ownerPage.getByRole("table", {
      name: "Participant availability by appointment option",
      exact: true,
    });
    await expect(ownerLedger).toBeVisible();
    await expect(
      ownerLedger.getByRole("columnheader", { name: guestName, exact: true }),
    ).toHaveCount(1);
    const initialOptionRow = ownerLedger.getByRole("row").filter({
      has: ownerPage.getByRole("rowheader", {
        name: INITIAL_DATE_LABEL,
        exact: true,
      }),
    });
    await expect(initialOptionRow).toHaveCount(1);
    await expect(
      initialOptionRow.locator(
        `[data-option-id="${initialOptionId}"][data-participant-id="${guestParticipantId}"] [role="img"]`,
      ),
    ).toHaveAttribute("aria-label", `${guestName}: Yes`);

    const ownerSuggestionSnapshotPromise = waitForMatchingAppointmentSnapshot(
      ownerPage,
      ownerSnapshotPath,
      (snapshot) => (
        snapshot.appointment.publicId === created.publicId
        && snapshot.appointment.revision > savedResponse.revision
        && snapshot.viewer.activeParticipantId === ownerParticipantId
        && snapshot.participants.some((participant) => (
          participant.id === guestParticipantId
          && participant.displayName === guestName
        ))
        && snapshot.options.some((option) => (
          option.kind === "DATE"
          && option.startDate === SUGGESTED_DATE
          && option.creatorParticipantId === guestParticipantId
          && option.responses.some((response) => (
            response.participantId === guestParticipantId
            && response.value === "YES"
          ))
        ))
      ),
    );
    const optionsPath = `/api/appointments/${created.publicId}/options`;
    const addOptionResponsePromise = waitForExactRouteResponse(
      page,
      "POST",
      optionsPath,
    );
    await addSuggestionViaBoard(page, SUGGESTED_DATE);

    const addOptionResponse = await addOptionResponsePromise;
    expect(addOptionResponse.status()).toBe(201);
    const addOptionPayload: unknown = await addOptionResponse.json();
    const added = addOptionSuccessSchema.parse(addOptionPayload);
    expect(added.optionId).not.toBe(initialOptionId);
    expect(added.revision).toBeGreaterThan(savedResponse.revision);

    const ownerSuggestionRefresh = await ownerSuggestionSnapshotPromise;
    expect(ownerSuggestionRefresh.response.status()).toBe(200);
    expect(
      ownerSuggestionRefresh.snapshot.appointment.revision,
    ).toBeGreaterThanOrEqual(added.revision);
    const streamedSuggestedOption = ownerSuggestionRefresh.snapshot.options.find(
      ({ id }) => id === added.optionId,
    );
    expect(streamedSuggestedOption).toMatchObject({
      id: added.optionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: guestParticipantId,
      responses: [{ participantId: guestParticipantId, value: "YES" }],
    });

    await expect(
      ownerPage.getByRole("group", {
        name: SUGGESTED_DATE_LABEL,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ownerLedger.locator(`tbody th[data-option-id="${added.optionId}"]`),
    ).toHaveText(SUGGESTED_DATE_LABEL);
    const suggestedOptionRow = ownerLedger.getByRole("row").filter({
      has: ownerPage.getByRole("rowheader", {
        name: SUGGESTED_DATE_LABEL,
        exact: true,
      }),
    });
    await expect(suggestedOptionRow).toHaveCount(1);
    await expect(
      suggestedOptionRow.locator(
        `[data-option-id="${added.optionId}"][data-participant-id="${guestParticipantId}"] [role="img"]`,
      ),
    ).toHaveAttribute("aria-label", `${guestName}: Yes`);

    await expect(ownerPage).toHaveURL(created.publicUrl);
    expect(observedMainFrameNavigations).toEqual([]);
    expect(observedDocumentRequests).toEqual([]);

    const finalSnapshot = await readAppointmentSnapshot(
      ownerPage,
      created.publicId,
    );
    expect(finalSnapshot.appointment).toMatchObject({
      publicId: created.publicId,
      status: "ACTIVE",
      revision: added.revision,
    });
    expect(finalSnapshot.viewer.kind).toBe("authenticated");
    expect(finalSnapshot.viewer.activeParticipantId).toBe(ownerParticipantId);
    expect(
      finalSnapshot.participants.filter(({ id }) => id === guestParticipantId),
    ).toEqual([{ id: guestParticipantId, displayName: guestName }]);
    expect(
      finalSnapshot.participants.filter(({ displayName }) => (
        displayName === guestName
      )),
    ).toEqual([{ id: guestParticipantId, displayName: guestName }]);
    expect(finalSnapshot.options.map(({ id }) => id)).toEqual([
      initialOptionId,
      added.optionId,
    ]);

    const persistedInitialOption = finalSnapshot.options.find(
      ({ id }) => id === initialOptionId,
    );
    expect(persistedInitialOption).toMatchObject({
      id: initialOptionId,
      kind: "DATE",
      startDate: INITIAL_DATE,
    });
    expect(
      persistedInitialOption?.responses.filter(
        ({ participantId }) => participantId === guestParticipantId,
      ),
    ).toEqual([{ participantId: guestParticipantId, value: "YES" }]);

    const persistedSuggestedOption = finalSnapshot.options.find(
      ({ id }) => id === added.optionId,
    );
    expect(persistedSuggestedOption).toMatchObject({
      id: added.optionId,
      kind: "DATE",
      startDate: SUGGESTED_DATE,
      creatorParticipantId: guestParticipantId,
      responses: [{ participantId: guestParticipantId, value: "YES" }],
      yesCount: 1,
      noCount: 0,
    });
  } finally {
    ownerPage.off("framenavigated", observeFrameNavigation);
    ownerPage.off("request", observeRequest);
  }
});
