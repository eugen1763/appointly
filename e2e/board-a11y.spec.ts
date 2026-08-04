import type { Page } from "@playwright/test";

import {
  createAppointmentSuccessSchema,
  putResponseSuccessSchema,
} from "../src/features/appointments/contracts";
import type { CreateAppointmentSuccess } from "../src/features/appointments/contracts";
import { expectSegmentFocusRing, tabTo } from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const OWNER_NAME = "Task 56 Board Owner";
const TABLE_NAME = "Participant availability by appointment option";
const PHONE_VIEWPORT = { width: 390, height: 844 } as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

const TREE_ROLES = [
  "table",
  "row",
  "rowgroup",
  "rowheader",
  "columnheader",
  "cell",
  "group",
  "radio",
] as const;

interface AxNode {
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly properties?: readonly {
    readonly name?: string;
    readonly value?: { readonly value?: unknown };
  }[];
}

function nodeRole(node: AxNode): string {
  return typeof node.role?.value === "string" ? node.role.value : "";
}

function nodeName(node: AxNode): string {
  return typeof node.name?.value === "string" ? node.name.value : "";
}

function namesOf(nodes: readonly AxNode[], role: string): string[] {
  return nodes.filter((node) => nodeRole(node) === role).map(nodeName);
}

function checkedRadioNames(nodes: readonly AxNode[]): string[] {
  return nodes
    .filter((node) => nodeRole(node) === "radio" && node.properties?.some(
      (property) => property.name === "checked" && property.value?.value === "true",
    ))
    .map(nodeName)
    .sort();
}

function roleTally(nodes: readonly AxNode[]): Record<string, number> {
  return Object.fromEntries(TREE_ROLES.map((role) => (
    [role, nodes.filter((node) => nodeRole(node) === role).length]
  )));
}

/**
 * Seeds through the creation route rather than the composer. This spec is the only
 * one that runs under all three engines, and the composer is a different surface
 * with its own (Chromium-only) coverage; driving it here would make an engine gate
 * for the board fail for reasons that have nothing to do with the board.
 */
async function createBoardAppointment(
  ownerPage: Page,
  title: string,
  startDates: readonly [string, string],
): Promise<CreateAppointmentSuccess> {
  await ownerPage.goto("/dashboard");
  // Same-origin browser fetch, as every other direct write in the suite does: the
  // route requires a matching Origin header, which an APIRequestContext omits.
  const created = await ownerPage.evaluate(async (input) => {
    const response = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json();
    return { status: response.status, body };
  }, {
    title,
    description: null,
    ownerDisplayName: OWNER_NAME,
    type: "DATE",
    optionLimit: 2,
    coOrganizerEmails: [],
    timeZone: "UTC",
    options: startDates.map((startDate) => ({ kind: "DATE", startDate })),
  });
  expect(created.status, "appointment creation status").toBe(201);
  return createAppointmentSuccessSchema.parse(created.body);
}

async function joinAs(page: Page, displayName: string): Promise<void> {
  const joinForm = page.getByRole("form", { name: "Join appointment", exact: true });
  await expect(joinForm).toBeVisible();
  await joinForm.getByLabel("Display name", { exact: true }).fill(displayName);
  const joined = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/participants")
  ));
  await joinForm.getByRole("button", { name: "Join appointment", exact: true }).click();
  expect((await joined).status()).toBe(201);
}

/**
 * Playwright computes roles from the DOM, so every getByRole assertion in the suite
 * would keep passing if an explicit role attribute were dropped from the board while
 * screen readers broke. This reads Chrome's real platform tree instead. It is the
 * only gate that can see a card-mode ARIA regression: keep it.
 */
test("card and table modes expose the same platform accessibility tree", async ({
  browserName,
  ownerPage,
  page,
}) => {
  test.skip(browserName !== "chromium", "Accessibility.getFullAXTree is Chromium only");

  const options = [
    { startDate: "2027-03-15", label: "March 15, 2027" },
    { startDate: "2027-03-16", label: "March 16, 2027" },
  ] as const;
  const created = await createBoardAppointment(
    ownerPage,
    "Task 56 board platform tree",
    [options[0].startDate, options[1].startDate],
  );

  const guestName = `Task 56 Tree Guest ${created.publicId.slice(0, 8)}`;
  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(created.publicUrl);
  await joinAs(page, guestName);

  const firstGroup = page.getByRole("group", { name: options[0].label, exact: true });
  const saved = page.waitForResponse((response) => (
    response.request().method() === "PUT"
    && new URL(response.url()).pathname.includes("/responses/")
  ));
  await firstGroup.getByRole("radio", { name: "Yes", exact: true }).check();
  const savedPayload: unknown = await (await saved).json();
  expect(putResponseSuccessSchema.parse(savedPayload).value).toBe("YES");
  await expect(firstGroup.locator("[data-save-status]")).toHaveText("Saved");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");

  const tallies: Record<string, Record<string, number>> = {};
  for (const viewport of [PHONE_VIEWPORT, DESKTOP_VIEWPORT]) {
    const label = `${viewport.width}px`;
    await page.setViewportSize(viewport);
    await expect(page.getByRole("table", { name: TABLE_NAME, exact: true })).toBeVisible();

    const { nodes } = await cdp.send("Accessibility.getFullAXTree") as {
      nodes: readonly AxNode[];
    };
    const live = nodes.filter((node) => node.ignored !== true);

    expect(namesOf(live, "table"), `${label} table nodes`).toEqual([TABLE_NAME]);
    expect(namesOf(live, "rowheader"), `${label} rowheaders`).toEqual([
      options[0].label,
      options[1].label,
    ]);
    // The whole point of clipping rather than hiding the thead: the column headers
    // must still exist on the phone, where no visible column is left.
    for (const columnName of ["Option", "Your response", "Result", OWNER_NAME]) {
      expect(namesOf(live, "columnheader"), `${label} columnheaders`)
        .toContain(columnName);
    }
    expect(namesOf(live, "group"), `${label} groups`).toEqual([
      options[0].label,
      options[1].label,
    ]);

    const radioNames = namesOf(live, "radio");
    expect(radioNames, `${label} radio count`).toHaveLength(6);
    expect(
      [...new Set(radioNames)].sort(),
      `${label} radio names`,
    ).toEqual(["No", "Unanswered", "Yes"]);
    expect(checkedRadioNames(live), `${label} checked radios`)
      .toEqual(["Unanswered", "Yes"]);

    expect(
      namesOf(live, "image").filter((name) => name === `${OWNER_NAME}: Yes`),
      `${label} owner marks`,
    ).toHaveLength(2);

    tallies[label] = roleTally(live);
  }

  expect(
    tallies[`${PHONE_VIEWPORT.width}px`],
    "the platform role tally is identical in card mode and table mode",
  ).toEqual(tallies[`${DESKTOP_VIEWPORT.width}px`]);
});

test("the board answers correctly in every engine", async ({
  browserName,
  ownerPage,
  page,
}) => {
  const options = [
    { startDate: "2027-04-12", label: "April 12, 2027" },
    { startDate: "2027-04-13", label: "April 13, 2027" },
  ] as const;
  const created = await createBoardAppointment(
    ownerPage,
    "Task 56 board cross-browser",
    [options[0].startDate, options[1].startDate],
  );

  await page.setViewportSize(PHONE_VIEWPORT);
  await page.goto(created.publicUrl);
  await expect(page).toHaveURL(new URL(created.publicUrl, E2E_BASE_URL).href);
  await joinAs(page, `Task 56 Engine Guest ${created.publicId.slice(0, 8)}`);

  const firstGroup = page.getByRole("group", { name: options[0].label, exact: true });
  const unansweredRadio = firstGroup.getByRole("radio", { name: "Unanswered", exact: true });
  await expect(unansweredRadio).toBeChecked();
  await tabTo(page, unansweredRadio, "first option checked Unanswered radio");
  await expectSegmentFocusRing(unansweredRadio, "first option checked Unanswered radio");

  const yesRadio = firstGroup.getByRole("radio", { name: "Yes", exact: true });
  const saved = page.waitForResponse((response) => (
    response.request().method() === "PUT"
    && new URL(response.url()).pathname.includes("/responses/")
  ));
  /* How the selection is made is the engine's business, not the board's. Chromium
     and Firefox move the selection with the arrow keys. Playwright's Linux WebKit
     build does not: arrows leave the group untouched and Tab rovers straight past
     it, so the only keyboard route to another answer is Space on the focused radio.
     That is native radio-group behaviour, identical before and after this phase, so
     the engines are branched here rather than the assertion being relaxed — every
     engine still has to produce the save, the checked state and the announcement. */
  if (browserName === "webkit") {
    await yesRadio.focus();
    await page.keyboard.press("Space");
  } else {
    await page.keyboard.press("ArrowRight");
  }
  expect((await saved).status()).toBe(200);
  await expect(yesRadio).toBeChecked();
  await expect(firstGroup.locator("[data-save-status]")).toHaveText("Saved");

  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  // DOM-computed sanity only; the platform gate is the Chromium test above.
  const board = page.getByRole("table", { name: TABLE_NAME, exact: true });
  await expect(board).toHaveCount(1);
  await expect(board.getByRole("rowheader", { name: options[0].label, exact: true }))
    .toHaveCount(1);
  await expect(board.getByRole("columnheader", { name: OWNER_NAME, exact: true }))
    .toHaveCount(1);
  await expect(board.getByRole("columnheader", { name: "Your response", exact: true }))
    .toHaveCount(1);
});
