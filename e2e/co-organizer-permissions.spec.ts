import type { Page, Response } from "@playwright/test";

import {
  appointmentRouteContracts,
  revisionSuccessSchema,
} from "../src/features/appointments/contracts";
import {
  createAppointmentThroughWizard,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { CO_ORGANIZER_IDENTITY, E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const INITIAL_TITLE = "Task 46 co-organizer permissions";
const UPDATED_TITLE = "Task 46 co-organizer updated";
const CANDIDATE_DATE = "2030-04-03";
const CANDIDATE_LABEL = "April 3, 2030";

interface BrowserJsonRequest {
  readonly path: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: Readonly<Record<string, string>>;
}

interface BrowserJsonResult {
  readonly status: number;
  readonly body: unknown;
}

function waitForExactRouteResponse(
  page: Page,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
): Promise<Response> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

async function sameOriginJsonFetch(
  page: Page,
  request: BrowserJsonRequest,
): Promise<BrowserJsonResult> {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, {
      method,
      headers: body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const responseBody: unknown = await response.json();

    return { status: response.status, body: responseBody };
  }, request);
}

test("co-organizer binds dashboard access and respects owner-only permissions", async ({
  ownerPage,
  coOrganizerPage,
}) => {
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: INITIAL_TITLE,
    type: "DATE",
    optionLimit: 1,
    coOrganizerEmails: [CO_ORGANIZER_IDENTITY.email],
    candidates: [{ kind: "DATE", startDate: CANDIDATE_DATE }],
  });

  const ownerSnapshot = await readAppointmentSnapshot(
    ownerPage,
    created.publicId,
  );
  expect(ownerSnapshot.appointment).toMatchObject({
    publicId: created.publicId,
    title: INITIAL_TITLE,
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

  await coOrganizerPage.goto("/dashboard");
  const appointments = coOrganizerPage.getByRole("list", {
    name: "Appointments",
    exact: true,
  });
  const titleLink = coOrganizerPage.getByRole("link", {
    name: INITIAL_TITLE,
    exact: true,
  });
  const appointmentCard = appointments
    .getByRole("listitem")
    .filter({ has: titleLink });
  await expect(appointmentCard).toHaveCount(1);
  await expect(
    appointmentCard.getByText("Co-organizer", { exact: true }),
  ).toBeVisible();
  await expect(
    appointmentCard.getByText("Active", { exact: true }),
  ).toBeVisible();
  await expect(
    appointmentCard.getByText("Day", { exact: true }),
  ).toBeVisible();

  await appointmentCard.getByRole("link", {
    name: INITIAL_TITLE,
    exact: true,
  }).click();
  await expect(coOrganizerPage).toHaveURL(created.publicUrl);

  const coOrganizerSnapshot = await readAppointmentSnapshot(
    coOrganizerPage,
    created.publicId,
  );
  expect(coOrganizerSnapshot.viewer.kind).toBe("authenticated");
  expect(coOrganizerSnapshot.viewer.permissions).toEqual({
    canEditAppointment: true,
    canManageCoOrganizers: false,
    canDeleteAppointment: false,
    canFinalize: true,
    canReopen: false,
    canResetGuestLinks: true,
    canRespond: true,
    canSuggest: true,
  });

  const appointmentPath = `/api/appointments/${created.publicId}`;
  // A co-organizer renames through the heading itself, not through the API.
  const updateResponsePromise = waitForExactRouteResponse(
    coOrganizerPage,
    "PATCH",
    appointmentPath,
  );
  await coOrganizerPage.getByRole("button", {
    name: INITIAL_TITLE,
    exact: true,
  }).click();
  await coOrganizerPage.getByLabel("Appointment title").fill(UPDATED_TITLE);
  await coOrganizerPage.getByLabel("Appointment title").press("Enter");
  const updateResponse = await updateResponsePromise;
  expect(updateResponse.status()).toBe(200);
  const { revision: postEditRevision } = revisionSuccessSchema.parse(
    await updateResponse.json(),
  );
  expect(typeof postEditRevision).toBe("number");

  await coOrganizerPage.reload();
  await expect(coOrganizerPage.getByRole("heading", {
    level: 1,
    name: UPDATED_TITLE,
    exact: true,
  })).toBeVisible();
  await expect(coOrganizerPage.getByRole("heading", {
    name: "Delete appointment",
    exact: true,
  })).toHaveCount(0);
  await expect(coOrganizerPage.getByRole("button", {
    name: "Delete appointment",
    exact: true,
  })).toHaveCount(0);

  const activeSnapshot = await readAppointmentSnapshot(
    coOrganizerPage,
    created.publicId,
  );
  expect(activeSnapshot.appointment).toMatchObject({
    title: UPDATED_TITLE,
    status: "ACTIVE",
    revision: postEditRevision,
  });

  const managersPath = `${appointmentPath}/managers`;
  const managerListResult = await sameOriginJsonFetch(coOrganizerPage, {
    path: managersPath,
    method: "GET",
  });
  expect(managerListResult.status).toBe(403);
  expect(
    appointmentRouteContracts.listManagers.errors.bodySchema.parse(
      managerListResult.body,
    ),
  ).toEqual({
    error: {
      code: "FORBIDDEN",
      message: "Appointment owner access is required.",
    },
  });

  const managerAddResult = await sameOriginJsonFetch(coOrganizerPage, {
    path: managersPath,
    method: "POST",
    body: { email: "another-co-organizer@appointly.test" },
  });
  expect(managerAddResult.status).toBe(403);
  expect(
    appointmentRouteContracts.addManager.errors.bodySchema.parse(
      managerAddResult.body,
    ),
  ).toEqual({
    error: {
      code: "FORBIDDEN",
      message: "Appointment owner access is required.",
    },
  });

  const deleteResult = await sameOriginJsonFetch(coOrganizerPage, {
    path: appointmentPath,
    method: "DELETE",
    body: { title: UPDATED_TITLE },
  });
  expect(deleteResult.status).toBe(403);
  expect(
    appointmentRouteContracts.deleteAppointment.errors.bodySchema.parse(
      deleteResult.body,
    ),
  ).toEqual({
    error: {
      code: "FORBIDDEN",
      message: "Only the appointment owner can delete this appointment.",
    },
  });

  const snapshotAfterForbiddenCalls = await readAppointmentSnapshot(
    coOrganizerPage,
    created.publicId,
  );
  expect(snapshotAfterForbiddenCalls.appointment).toMatchObject({
    publicId: created.publicId,
    title: UPDATED_TITLE,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 1,
    finalOptionId: null,
    revision: postEditRevision,
  });
  expect(snapshotAfterForbiddenCalls.options).toHaveLength(1);
  expect(snapshotAfterForbiddenCalls.options[0]).toMatchObject({
    id: optionId,
    kind: "DATE",
    startDate: CANDIDATE_DATE,
  });

  const finalizeForm = coOrganizerPage.getByRole("row").filter({
    has: coOrganizerPage.getByRole("rowheader", {
      name: CANDIDATE_LABEL,
      exact: true,
    }),
  }).getByRole("form", { name: "Finalize appointment", exact: true });
  await expect(finalizeForm).toHaveAttribute("data-finalize-form", optionId);
  await finalizeForm.getByRole("button", {
    name: "Finalize",
    exact: true,
  }).click();

  const finalizedNotice = coOrganizerPage.getByText(
    "Appointment finalized. The selected option is marked below.",
    { exact: true },
  );
  await expect(finalizedNotice).toHaveAttribute("role", "status");
  await expect(finalizedNotice).toBeVisible();

  const finalSnapshot = await readAppointmentSnapshot(
    coOrganizerPage,
    created.publicId,
  );
  expect(finalSnapshot.appointment).toEqual({
    publicId: created.publicId,
    title: UPDATED_TITLE,
    description: null,
    type: "DATE",
    status: "FINALIZED",
    optionLimit: 1,
    finalOptionId: optionId,
    revision: expect.any(Number),
  });
  expect(finalSnapshot.appointment.revision).toBeGreaterThan(postEditRevision);
  expect(finalSnapshot.viewer.permissions.canReopen).toBe(true);
  expect(finalSnapshot.options).toHaveLength(1);
  expect(finalSnapshot.options[0]).toMatchObject({
    id: optionId,
    kind: "DATE",
    startDate: CANDIDATE_DATE,
  });
});
