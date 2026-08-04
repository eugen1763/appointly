import type { BrowserContext, Page, Response } from "@playwright/test";

import {
  appointmentRouteContracts,
  appointmentSnapshotSchema,
  guestAccessSuccessSchema,
  joinParticipantSuccessSchema,
  putResponseSuccessSchema,
  resetParticipantLinkSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 48 guest link reset";
const GUEST_NAME = "Task 48 Reset Guest";
const CANDIDATE_DATE = "2030-04-03";
const CANDIDATE_LABEL = "April 3, 2030";

type RouteMethod = "GET" | "POST" | "PUT";

interface BrowserRouteRequest {
  readonly method: Exclude<RouteMethod, "GET">;
  readonly path: string;
  readonly body?: Readonly<Record<string, string>>;
}

interface MatchingSnapshotResponse {
  readonly response: Response;
  readonly snapshot: AppointmentSnapshot;
}

type SnapshotPredicate = (snapshot: AppointmentSnapshot) => boolean;

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

async function waitForMatchingAppointmentSnapshot(
  page: Page,
  path: string,
  predicate: SnapshotPredicate,
): Promise<MatchingSnapshotResponse> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
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

async function requestFromPage(
  page: Page,
  request: BrowserRouteRequest,
): Promise<Response> {
  const responsePromise = waitForExactRouteResponse(
    page,
    request.method,
    request.path,
  );
  const triggerPromise = page.evaluate(async ({ method, path, body }) => {
    await fetch(path, {
      method,
      headers: body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }, request);
  const response = await responsePromise;
  await triggerPromise;
  return response;
}

test("resetting a guest link revokes old access and preserves the participant response", async ({
  ownerPage,
  page,
  browser,
}) => {
  const createdContexts: BrowserContext[] = [];

  try {
    const created = await createAppointmentThroughWizard(ownerPage, {
      title: TITLE,
      type: "DATE",
      optionLimit: 1,
      candidates: [{ kind: "DATE", startDate: CANDIDATE_DATE }],
    });

    const ownerSnapshot = await readAppointmentSnapshot(
      ownerPage,
      created.publicId,
    );
    expect(ownerSnapshot.appointment).toMatchObject({
      publicId: created.publicId,
      title: TITLE,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 1,
      finalOptionId: null,
    });
    expect(ownerSnapshot.options).toHaveLength(1);
    expect(ownerSnapshot.options[0]).toMatchObject({
      kind: "DATE",
      startDate: CANDIDATE_DATE,
    });
    const optionId = ownerSnapshot.options[0].id;

    await page.goto(created.publicUrl);
    await expect(page).toHaveURL(created.publicUrl);
    await expect(page.getByRole("form", {
      name: "Join appointment",
      exact: true,
    })).toBeVisible();

    await page.getByLabel("Display name", { exact: true }).fill(GUEST_NAME);
    const joinResponsePromise = waitForExactRouteResponse(
      page,
      "POST",
      `/api/appointments/${created.publicId}/participants`,
    );
    await page.getByRole("button", {
      name: "Join appointment",
      exact: true,
    }).click();
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
    const privateLink = privateLinkRegion.getByRole("link", {
      name: "Private edit link",
      exact: true,
    });
    const oldPrivateHref = await privateLink.getAttribute("href");
    if (oldPrivateHref === null) {
      throw new Error("Private edit link has no href");
    }
    expect(
      joined.editUrl === oldPrivateHref,
      "the visible private href matches the join contract",
    ).toBe(true);

    const optionGroup = page.getByRole("group", {
      name: CANDIDATE_LABEL,
      exact: true,
    });
    const yesResponse = optionGroup.getByRole("radio", {
      name: "Yes",
      exact: true,
    });
    await expect(yesResponse).toBeVisible();

    const participantSnapshotPath =
      `/api/appointments/${created.publicId}/snapshot?participantId=${encodeURIComponent(joined.participantId)}`;
    const savedResponsePromise = waitForExactRouteResponse(
      page,
      "PUT",
      `/api/appointments/${created.publicId}/responses/${optionId}`,
    );
    const savedSnapshotPromise = waitForMatchingAppointmentSnapshot(
      page,
      participantSnapshotPath,
      (snapshot) => (
        snapshot.appointment.revision > joined.revision
        && snapshot.viewer.activeParticipantId === joined.participantId
      ),
    );
    await yesResponse.check();

    const savedResponse = await savedResponsePromise;
    expect(savedResponse.status()).toBe(200);
    const savedPayload: unknown = await savedResponse.json();
    const saved = putResponseSuccessSchema.parse(savedPayload);
    expect(saved.value).toBe("YES");
    expect(saved.revision).toBeGreaterThan(joined.revision);

    const savedSnapshotResult = await savedSnapshotPromise;
    expect(savedSnapshotResult.response.status()).toBe(200);
    const savedSnapshot = savedSnapshotResult.snapshot;
    expect(savedSnapshot.appointment.revision).toBe(saved.revision);
    expect(savedSnapshot.viewer.activeParticipantId).toBe(joined.participantId);
    await expect(yesResponse).toBeChecked();
    await expect(optionGroup.locator(`[data-save-status="${optionId}"]`)).toHaveText(
      "Saved",
    );

    const oldSessionSnapshotPromise = waitForMatchingAppointmentSnapshot(
      page,
      participantSnapshotPath,
      (snapshot) => (
        snapshot.appointment.revision > saved.revision
        && snapshot.viewer.kind === "anonymous"
        && snapshot.viewer.activeParticipantId === null
        && snapshot.viewer.accessibleParticipants.length === 0
        && !snapshot.viewer.permissions.canRespond
      ),
    );
    const resetPath = `/api/appointments/${created.publicId}/participants/${joined.participantId}/reset-link`;
    const resetResponse = await requestFromPage(ownerPage, {
      method: "POST",
      path: resetPath,
    });
    expect(resetResponse.status()).toBe(200);
    const resetPayload: unknown = await resetResponse.json();
    const reset = resetParticipantLinkSuccessSchema.parse(resetPayload);
    expect(reset.participantId).toBe(joined.participantId);
    expect(
      reset.editUrl === oldPrivateHref,
      "reset returns a different private href",
    ).toBe(false);
    expect(reset.revision).toBeGreaterThan(saved.revision);
    const newPrivateHref = reset.editUrl;

    const oldSessionSnapshotResult = await oldSessionSnapshotPromise;
    expect(oldSessionSnapshotResult.response.status()).toBe(200);
    const oldSessionSnapshot = oldSessionSnapshotResult.snapshot;
    expect(oldSessionSnapshot.appointment.revision).toBe(reset.revision);
    expect(oldSessionSnapshot.viewer.kind).toBe("anonymous");
    expect(oldSessionSnapshot.viewer.activeParticipantId).toBeNull();
    expect(oldSessionSnapshot.viewer.accessibleParticipants).toEqual([]);
    expect(oldSessionSnapshot.viewer.permissions.canRespond).toBe(false);
    await expect(page.getByRole("region", {
      name: "Your response",
      exact: true,
    })).toHaveCount(0);
    await expect(page.getByRole("form", {
      name: "Join appointment",
      exact: true,
    })).toBeVisible();

    const deniedWriteResponse = await requestFromPage(page, {
      method: "PUT",
      path: `/api/appointments/${created.publicId}/responses/${optionId}`,
      body: {
        participantId: joined.participantId,
        value: "NO",
      },
    });
    expect(deniedWriteResponse.status()).toBe(403);
    const deniedWritePayload: unknown = await deniedWriteResponse.json();
    expect(
      appointmentRouteContracts.putResponse.errors.bodySchema.parse(
        deniedWritePayload,
      ),
    ).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Participant access is required.",
      },
    });

    const oldLinkContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    createdContexts.push(oldLinkContext);
    const oldLinkPage = await oldLinkContext.newPage();
    const oldLinkAccessPromise = waitForExactRouteResponse(
      oldLinkPage,
      "POST",
      `/api/appointments/${created.publicId}/guest-access`,
    );
    await oldLinkPage.goto(oldPrivateHref);
    const oldLinkAccess = await oldLinkAccessPromise;
    expect(oldLinkAccess.status()).toBe(403);
    const oldLinkPayload: unknown = await oldLinkAccess.json();
    expect(
      appointmentRouteContracts.exchangeGuestAccess.errors.bodySchema.parse(
        oldLinkPayload,
      ),
    ).toEqual({
      error: {
        code: "INVALID_EDIT_LINK",
        message: "This private edit link is invalid or no longer available.",
      },
    });
    await expect(oldLinkPage).toHaveURL(
      new URL(`/a/${created.publicId}/edit`, E2E_BASE_URL).href,
    );
    await expect(oldLinkPage.getByRole("heading", {
      level: 1,
      name: "Link unavailable",
      exact: true,
    })).toBeVisible();

    const newLinkContext = await browser.newContext({ baseURL: E2E_BASE_URL });
    createdContexts.push(newLinkContext);
    const newLinkPage = await newLinkContext.newPage();
    const newLinkAccessPromise = waitForExactRouteResponse(
      newLinkPage,
      "POST",
      `/api/appointments/${created.publicId}/guest-access`,
    );
    await newLinkPage.goto(newPrivateHref);
    const newLinkAccess = await newLinkAccessPromise;
    expect(newLinkAccess.status()).toBe(200);
    const newLinkPayload: unknown = await newLinkAccess.json();
    const restored = guestAccessSuccessSchema.parse(newLinkPayload);
    expect(restored.participantId).toBe(joined.participantId);
    await expect(newLinkPage).toHaveURL(created.publicUrl);

    const savedParticipant = newLinkPage.getByRole("region", {
      name: "Saved participant",
      exact: true,
    });
    await expect(savedParticipant).toContainText(`Returning as ${GUEST_NAME}`);
    const restoredOptionGroup = newLinkPage.getByRole("group", {
      name: CANDIDATE_LABEL,
      exact: true,
    });
    await expect(restoredOptionGroup.getByRole("radio", {
      name: "Yes",
      exact: true,
    })).toBeChecked();

    const restoredSnapshot = await readAppointmentSnapshot(
      newLinkPage,
      created.publicId,
    );
    expect(restoredSnapshot.appointment.revision).toBe(reset.revision);
    expect(restoredSnapshot.viewer.kind).toBe("guest");
    expect(restoredSnapshot.viewer.activeParticipantId).toBe(joined.participantId);
    expect(restoredSnapshot.viewer.accessibleParticipants).toEqual([{
      id: joined.participantId,
      displayName: GUEST_NAME,
    }]);

    const participantRows = restoredSnapshot.participants.filter(
      ({ id }) => id === joined.participantId,
    );
    expect(participantRows).toEqual([{
      id: joined.participantId,
      displayName: GUEST_NAME,
    }]);
    const sameNameRows = restoredSnapshot.participants.filter(
      ({ displayName }) => displayName === GUEST_NAME,
    );
    expect(sameNameRows).toEqual(participantRows);

    expect(restoredSnapshot.options).toHaveLength(1);
    const restoredOption = restoredSnapshot.options[0];
    expect(restoredOption).toMatchObject({
      id: optionId,
      kind: "DATE",
      startDate: CANDIDATE_DATE,
    });
    expect(restoredOption.responses.filter(
      ({ participantId }) => participantId === joined.participantId,
    )).toEqual([{
      participantId: joined.participantId,
      value: "YES",
    }]);
  } finally {
    await Promise.all(createdContexts.map(async (context) => context.close()));
  }
});
