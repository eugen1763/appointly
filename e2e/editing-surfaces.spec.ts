import type { Page, Response } from "@playwright/test";

import {
  createAppointmentThroughWizard,
  openManageTools,
  readAppointmentSnapshot,
} from "./appointment-helpers";
import { CO_ORGANIZER_IDENTITY, E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const OWNER_TITLE = "Task 57 owner editing surface";
const DESCRIPTION = "Bring the roadmap.\n\nWe decide this week.";
const ENROLMENT_TITLE = "Task 57 co-organizer enrolment";
const FIRST_DATE = "2030-05-04";
const FIRST_LABEL = "May 4, 2030";
const SECOND_DATE = "2030-05-05";
const SECOND_LABEL = "May 5, 2030";

function waitForExactRouteResponse(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
): Promise<Response> {
  const expectedUrl = new URL(path, E2E_BASE_URL).href;
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

test("owner edits details and manages co-organizers from one surface", async ({
  ownerPage,
}) => {
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: OWNER_TITLE,
    type: "DATE",
    optionLimit: 5,
    candidates: [
      { kind: "DATE", startDate: FIRST_DATE },
      { kind: "DATE", startDate: SECOND_DATE },
    ],
  });
  const appointmentPath = `/api/appointments/${created.publicId}`;

  await test.step("1. Add a description through the heading area", async () => {
    await ownerPage.goto(created.publicUrl);
    const descriptionSaved = waitForExactRouteResponse(
      ownerPage,
      "PATCH",
      appointmentPath,
    );
    await ownerPage.getByRole("button", {
      name: "Add a description",
      exact: true,
    }).click();
    await ownerPage.getByLabel("Appointment description").fill(DESCRIPTION);
    await ownerPage.getByRole("button", {
      name: "Save description",
      exact: true,
    }).click();
    expect((await descriptionSaved).status()).toBe(200);

    // Named by the description alone: the ✎ is decoration and stays out of the name.
    await expect(ownerPage.getByRole("button", {
      name: "Bring the roadmap. We decide this week.",
      exact: true,
    })).toBeVisible();
  });

  await test.step("2. Tighten the option limit, then hit its floor", async () => {
    await openManageTools(ownerPage);
    // By role: the section heading carries the same name as the field.
    const limitField = ownerPage.getByRole("spinbutton", {
      name: "Option limit",
      exact: true,
    });
    const saveLimit = ownerPage.getByRole("button", {
      name: "Save option limit",
      exact: true,
    });

    const limitSaved = waitForExactRouteResponse(ownerPage, "PATCH", appointmentPath);
    await limitField.fill("2");
    await saveLimit.click();
    expect((await limitSaved).status()).toBe(200);
    await expect(
      ownerPage.getByText("Currently 2 of 2 options used.", { exact: true }),
    ).toBeVisible();

    const limitRejected = waitForExactRouteResponse(ownerPage, "PATCH", appointmentPath);
    await limitField.fill("1");
    await saveLimit.click();
    expect((await limitRejected).status()).toBe(409);
    await expect(ownerPage.getByRole("alert").filter({
      hasText: "Option limit cannot be lower than the current option count.",
    })).toBeVisible();
  });

  await test.step("3. Add, re-add and remove a co-organizer", async () => {
    const managerList = ownerPage.getByRole("list", {
      name: "Co-organizers",
      exact: true,
    });
    await expect(managerList).toBeVisible();
    const coOrganizerRow = managerList.getByRole("listitem").filter({
      hasText: CO_ORGANIZER_IDENTITY.email,
    });
    await expect(coOrganizerRow).toHaveCount(0);

    const emailField = ownerPage.getByRole("textbox", {
      name: "Co-organizer email",
      exact: true,
    });
    const addButton = ownerPage.getByRole("button", {
      name: "Add co-organizer",
      exact: true,
    });
    await emailField.fill(CO_ORGANIZER_IDENTITY.email);
    await addButton.click();

    // The e2e co-organizer has an account, so the invitation binds immediately.
    await expect(coOrganizerRow).toHaveCount(1);
    await expect(coOrganizerRow.getByText("Bound", { exact: true })).toBeVisible();
    await expect(
      ownerPage.getByText("1 of 20 co-organizers", { exact: true }),
    ).toBeVisible();

    await emailField.fill(CO_ORGANIZER_IDENTITY.email);
    await addButton.click();
    await expect(ownerPage.getByRole("alert").filter({
      hasText: "That email already belongs to an appointment manager.",
    })).toBeVisible();
    await expect(coOrganizerRow).toHaveCount(1);

    /*
     * The only browser-issued DELETE in the suite. The route's own unit test
     * builds a synthetic Request, which undici gives `body: null`, so it cannot
     * distinguish "no body" from "empty body" — a guard that rejected every real
     * DELETE passed that test for as long as it existed. Keep this step.
     */
    await ownerPage.getByRole("button", {
      name: `Remove ${CO_ORGANIZER_IDENTITY.email}`,
      exact: true,
    }).click();
    await expect(coOrganizerRow).toHaveCount(0);
    await expect(
      ownerPage.getByText("0 of 20 co-organizers", { exact: true }),
    ).toBeVisible();
  });

  await test.step("4. Clear the second answer so one option leads", async () => {
    const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
    const second = snapshot.options.find((option) => (
      option.kind === "DATE" && option.startDate === SECOND_DATE
    ));
    if (second === undefined) throw new Error("Second option was not created");

    const group = ownerPage.getByRole("group", { name: SECOND_LABEL, exact: true });
    const cleared = waitForExactRouteResponse(
      ownerPage,
      "PUT",
      `${appointmentPath}/responses/${second.id}`,
    );
    await group.getByRole("radio", { name: "Unanswered", exact: true }).check();
    expect((await cleared).status()).toBe(200);
    await expect(group.locator(`[data-save-status="${second.id}"]`))
      .toHaveText("Saved");
  });

  await test.step("5. Read the whole state off the dashboard card", async () => {
    await ownerPage.goto("/dashboard");
    const card = ownerPage.getByRole("list", { name: "Appointments", exact: true })
      .getByRole("listitem")
      .filter({
        has: ownerPage.getByRole("link", { name: OWNER_TITLE, exact: true }),
      });
    await expect(card).toHaveCount(1);

    await expect(card.getByText("Options", { exact: true })).toBeVisible();
    await expect(card.getByText("Participants", { exact: true })).toBeVisible();
    await expect(card.getByText("Leading", { exact: true })).toBeVisible();
    await expect(card.getByText(FIRST_LABEL, { exact: true })).toBeVisible();
    await expect(card.getByText("1 yes · 0 no", { exact: true })).toBeVisible();

    const values = await card.locator("dl dd").allInnerTexts();
    expect(values.slice(0, 4)).toEqual(["Active", "Day", "2", "1"]);
  });
});

test("a co-organizer blocked by a name collision enrols under a new name and responds", async ({
  page,
  ownerPage,
  coOrganizerPage,
}) => {
  const created = await createAppointmentThroughWizard(ownerPage, {
    title: ENROLMENT_TITLE,
    type: "DATE",
    optionLimit: 2,
    coOrganizerEmails: [CO_ORGANIZER_IDENTITY.email],
    candidates: [{ kind: "DATE", startDate: FIRST_DATE }],
  });

  await test.step("1. A guest takes the co-organizer's own account name", async () => {
    await page.goto(created.publicUrl);
    await page.getByLabel("Display name", { exact: true })
      .fill(CO_ORGANIZER_IDENTITY.name);
    const joined = waitForExactRouteResponse(
      page,
      "POST",
      `/api/appointments/${created.publicId}/participants`,
    );
    await page.getByRole("button", { name: "Join appointment", exact: true }).click();
    expect((await joined).status()).toBe(201);
  });

  await test.step("2. Auto-enrolment fails, so the co-organizer is asked for a name", async () => {
    await coOrganizerPage.goto(created.publicUrl);
    const enrolmentForm = coOrganizerPage.getByRole("form", {
      name: "Join as participant",
      exact: true,
    });
    await expect(enrolmentForm).toBeVisible();

    const snapshot = await readAppointmentSnapshot(
      coOrganizerPage,
      created.publicId,
    );
    expect(snapshot.viewer.needsParticipantName).toBe(true);
    expect(snapshot.viewer.activeParticipantId).toBeNull();

    await enrolmentForm.getByLabel("Display name", { exact: true })
      .fill(CO_ORGANIZER_IDENTITY.name);
    await coOrganizerPage.getByRole("button", {
      name: "Join as participant",
      exact: true,
    }).click();
    await expect(coOrganizerPage.getByRole("alert").filter({
      hasText: "That participant name is already in use.",
    })).toBeVisible();
  });

  await test.step("3. A free name enrols and unlocks responding", async () => {
    await coOrganizerPage.getByRole("form", {
      name: "Join as participant",
      exact: true,
    }).getByLabel("Display name", { exact: true }).fill("Casey the Second");
    await coOrganizerPage.getByRole("button", {
      name: "Join as participant",
      exact: true,
    }).click();

    await expect(coOrganizerPage.getByRole("heading", {
      name: "Your response",
      exact: true,
    })).toBeVisible();

    const snapshot = await readAppointmentSnapshot(
      coOrganizerPage,
      created.publicId,
    );
    const option = snapshot.options[0];
    if (option === undefined) throw new Error("Appointment has no option");
    const group = coOrganizerPage.getByRole("group", {
      name: FIRST_LABEL,
      exact: true,
    });
    const saved = waitForExactRouteResponse(
      coOrganizerPage,
      "PUT",
      `/api/appointments/${created.publicId}/responses/${option.id}`,
    );
    await group.getByRole("radio", { name: "Yes", exact: true }).check();
    expect((await saved).status()).toBe(200);
    await expect(group.locator(`[data-save-status="${option.id}"]`))
      .toHaveText("Saved");
  });
});
