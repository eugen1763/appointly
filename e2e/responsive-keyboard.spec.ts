import type {
  BrowserContext,
  Locator,
  Page,
  Response,
} from "@playwright/test";

import {
  joinParticipantSuccessSchema,
  putResponseSuccessSchema,
} from "../src/features/appointments/contracts";
import type { AppointmentSnapshot } from "../src/features/appointments/contracts";
import {
  createAppointmentThroughWizard,
  expectSegmentFocusRing,
  readAppointmentSnapshot,
  tabTo,
} from "./appointment-helpers";
import { E2E_BASE_URL } from "./auth-identities";
import { expect, test } from "./fixtures";

const TITLE = "Task 55 responsive keyboard appointment";
const OWNER_NAME = "Task 55 Owner";
const DATE_OPTIONS = [
  { startDate: "2031-06-11", label: "June 11, 2031" },
  { startDate: "2031-06-12", label: "June 12, 2031" },
] as const;
const MOBILE_VIEWPORT = { width: 320, height: 800 } as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const TABLE_NAME = "Participant availability by appointment option";

type PointerObservations = Record<
  "pointerdown" | "mousedown" | "touchstart",
  number
>;
type ResponseValue = "YES" | "NO";

function exactRouteUrl(path: string): string {
  return new URL(path, E2E_BASE_URL).href;
}

function waitForExactRouteResponse(
  page: Page,
  method: "POST" | "PUT",
  path: string,
): Promise<Response> {
  const expectedUrl = exactRouteUrl(path);
  return page.waitForResponse((response) => (
    response.url() === expectedUrl
    && response.request().method() === method
  ));
}

async function installPointerObserver(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const observations = {
      pointerdown: 0,
      mousedown: 0,
      touchstart: 0,
    };
    Object.defineProperty(window, "__appointlyPointerObservations", {
      configurable: false,
      enumerable: false,
      value: observations,
      writable: false,
    });
    for (const eventType of ["pointerdown", "mousedown", "touchstart"] as const) {
      window.addEventListener(eventType, () => {
        observations[eventType] += 1;
      }, { capture: true });
    }
  });
}

async function readPointerObservations(page: Page): Promise<PointerObservations> {
  return page.evaluate(() => {
    const observedWindow = window as typeof window & {
      __appointlyPointerObservations?: PointerObservations;
    };
    const observations = observedWindow.__appointlyPointerObservations;
    if (observations === undefined) {
      throw new Error("Pointer observer was not installed before page interaction");
    }
    return { ...observations };
  });
}

async function expectNoPointerObservations(page: Page): Promise<void> {
  expect(await readPointerObservations(page)).toEqual({
    pointerdown: 0,
    mousedown: 0,
    touchstart: 0,
  });
}

/**
 * Computes the focus indicator on the focused element itself, so it is only valid
 * for controls that are themselves painted. Never point it at a segmented-control
 * radio: those inputs are transparent overlays, the global :focus-visible outline
 * computes on them and reads as visible while nothing appears on screen. Use
 * expectSegmentFocusRing for radios.
 */
async function expectActiveWithVisibleFocus(
  target: Locator,
  targetName: string,
): Promise<void> {
  const focus = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const transparentColors = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
    const outlineVisible = style.outlineStyle !== "none"
      && Number.parseFloat(style.outlineWidth) > 0
      && !transparentColors.has(style.outlineColor);
    const boxShadowVisible = style.boxShadow !== "none"
      && !transparentColors.has(style.boxShadow);
    const textDecorationVisible = style.textDecorationLine !== "none"
      && !transparentColors.has(style.textDecorationColor);
    return {
      active: element === document.activeElement,
      boxShadow: style.boxShadow,
      boxShadowVisible,
      outline: style.outline,
      outlineVisible,
      textDecoration: style.textDecoration,
      textDecorationVisible,
    };
  });

  expect(focus.active, `${targetName} is document.activeElement`).toBe(true);
  expect(
    focus.outlineVisible || focus.boxShadowVisible || focus.textDecorationVisible,
    `${targetName} has a computed visible focus indicator: ${JSON.stringify(focus)}`,
  ).toBe(true);
}

async function expectExactViewportAndNoOverflow(
  page: Page,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  expect(page.viewportSize()).toEqual(viewport);
  const dimensions = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.innerWidth).toBe(viewport.width);
  expect(dimensions.innerHeight).toBe(viewport.height);
  expect(dimensions.clientWidth).toBe(viewport.width);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

/**
 * Records the ring at the moment the arrow key activates the radio. Saving disables
 * the fieldset, which blurs the radio, so the indicator cannot be read afterwards —
 * that is existing response behaviour this phase deliberately leaves alone. Like
 * expectSegmentFocusRing this reads the sibling face, never the transparent input.
 */
async function installSegmentActivationFocusObserver(radio: Locator): Promise<void> {
  await radio.evaluate((element) => {
    type SegmentActivationObservation = {
      readonly active: boolean;
      readonly boxShadow: string;
      readonly boxShadowVisible: boolean;
      readonly outline: string;
      readonly outlineVisible: boolean;
    };
    const observedElement = element as HTMLElement & {
      __appointlySegmentActivationObservation?: SegmentActivationObservation | null;
    };
    observedElement.__appointlySegmentActivationObservation = null;
    observedElement.addEventListener("click", () => {
      const face = observedElement.nextElementSibling;
      if (face === null) return;
      const style = getComputedStyle(face);
      const transparentColors = new Set(["transparent", "rgba(0, 0, 0, 0)"]);
      observedElement.__appointlySegmentActivationObservation = {
        active: observedElement === document.activeElement,
        boxShadow: style.boxShadow,
        boxShadowVisible: style.boxShadow !== "none"
          && !transparentColors.has(style.boxShadow),
        outline: style.outline,
        outlineVisible: style.outlineStyle !== "none"
          && Number.parseFloat(style.outlineWidth) > 0
          && !transparentColors.has(style.outlineColor),
      };
    }, { capture: true, once: true });
  });
}

async function expectObservedSegmentActivationFocus(
  radio: Locator,
  targetName: string,
): Promise<void> {
  const focus = await radio.evaluate((element) => {
    type SegmentActivationObservation = {
      readonly active: boolean;
      readonly boxShadow: string;
      readonly boxShadowVisible: boolean;
      readonly outline: string;
      readonly outlineVisible: boolean;
    };
    return (element as HTMLElement & {
      __appointlySegmentActivationObservation?: SegmentActivationObservation | null;
    }).__appointlySegmentActivationObservation ?? null;
  });
  expect(focus, `${targetName} received a keyboard-generated native click`).not.toBeNull();
  if (focus === null) throw new Error(`${targetName} activation observation is absent`);
  expect(focus.active, `${targetName} became document.activeElement`).toBe(true);
  expect(
    focus.outlineVisible || focus.boxShadowVisible,
    `${targetName} painted an opaque ring on its visible face at activation: ${JSON.stringify(focus)}`,
  ).toBe(true);
}

async function expectComputedLayout(
  locator: Locator,
  expectedDisplay: "none" | "block" | "grid" | "flex" | "table",
  layoutName: string,
): Promise<void> {
  const layout = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      display: style.display,
      height: bounds.height,
      visibility: style.visibility,
      width: bounds.width,
    };
  });
  expect(layout.display, `${layoutName} computed display`).toBe(expectedDisplay);
  expect(layout.visibility, `${layoutName} computed visibility`).toBe("visible");
  if (expectedDisplay === "none") {
    expect(layout.width, `${layoutName} hidden width`).toBe(0);
    expect(layout.height, `${layoutName} hidden height`).toBe(0);
  } else {
    expect(layout.width, `${layoutName} visible width`).toBeGreaterThan(0);
    expect(layout.height, `${layoutName} visible height`).toBeGreaterThan(0);
  }
}

/** The board carries one cell per (option, participant) pair in either mode. */
function participantOptionCell(
  page: Page,
  participantId: string,
  optionId: string,
): Locator {
  return page.locator(
    `[data-participant-id="${participantId}"][data-option-id="${optionId}"]`,
  );
}

/** Another participant's answer reads as a person-qualified mark, not free text. */
function expectParticipantMark(
  page: Page,
  participantId: string,
  optionId: string,
  displayName: string,
  answer: "Yes" | "No" | "Unanswered",
): Promise<void> {
  return expect(
    participantOptionCell(page, participantId, optionId).locator('[role="img"]'),
  ).toHaveAttribute("aria-label", `${displayName}: ${answer}`);
}

function unansweredRadioOf(group: Locator): Locator {
  return group.getByRole("radio", { name: "Unanswered", exact: true });
}

function optionRow(page: Page, optionLabel: string): Locator {
  return page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: optionLabel, exact: true }),
  });
}

function assertParticipantExactlyOnce(
  snapshot: AppointmentSnapshot,
  participantId: string,
  displayName: string,
): void {
  expect(snapshot.participants.filter(({ id }) => id === participantId)).toEqual([
    { id: participantId, displayName },
  ]);
  expect(snapshot.participants.filter((participant) => (
    participant.displayName === displayName
  ))).toEqual([{ id: participantId, displayName }]);
}

function assertParticipantResponse(
  snapshot: AppointmentSnapshot,
  optionId: string,
  participantId: string,
  expectedValue: ResponseValue | null,
): void {
  const option = snapshot.options.find(({ id }) => id === optionId);
  expect(option, `snapshot contains option ${optionId}`).toBeDefined();
  const responses = option?.responses.filter((response) => (
    response.participantId === participantId
  )) ?? [];
  if (expectedValue === null) {
    expect(responses).toEqual([]);
  } else {
    expect(responses).toEqual([{ participantId, value: expectedValue }]);
  }
}

function assertFinalSnapshot(
  snapshot: AppointmentSnapshot,
  expected: Readonly<{
    desktopGuestId: string;
    desktopGuestName: string;
    finalRevision: number;
    mobileGuestId: string;
    mobileGuestName: string;
    optionIds: readonly [string, string];
    ownerParticipantId: string;
    publicId: string;
    viewerParticipantId: string;
  }>,
): void {
  expect(snapshot.appointment).toEqual({
    publicId: expected.publicId,
    title: TITLE,
    description: null,
    type: "DATE",
    status: "ACTIVE",
    optionLimit: 2,
    finalOptionId: null,
    revision: expected.finalRevision,
  });
  expect(snapshot.participants).toHaveLength(3);
  assertParticipantExactlyOnce(snapshot, expected.ownerParticipantId, OWNER_NAME);
  assertParticipantExactlyOnce(snapshot, expected.mobileGuestId, expected.mobileGuestName);
  assertParticipantExactlyOnce(snapshot, expected.desktopGuestId, expected.desktopGuestName);
  expect(snapshot.options.map(({ id }) => id)).toEqual(expected.optionIds);
  expect(snapshot.options.map((option) => ({
    creatorParticipantId: option.creatorParticipantId,
    id: option.id,
    kind: option.kind,
    startDate: option.kind === "DATE" ? option.startDate : null,
  }))).toEqual([
    {
      creatorParticipantId: expected.ownerParticipantId,
      id: expected.optionIds[0],
      kind: "DATE",
      startDate: DATE_OPTIONS[0].startDate,
    },
    {
      creatorParticipantId: expected.ownerParticipantId,
      id: expected.optionIds[1],
      kind: "DATE",
      startDate: DATE_OPTIONS[1].startDate,
    },
  ]);

  assertParticipantResponse(snapshot, expected.optionIds[0], expected.ownerParticipantId, "YES");
  assertParticipantResponse(snapshot, expected.optionIds[1], expected.ownerParticipantId, "YES");
  assertParticipantResponse(snapshot, expected.optionIds[0], expected.mobileGuestId, "YES");
  assertParticipantResponse(snapshot, expected.optionIds[1], expected.mobileGuestId, null);
  assertParticipantResponse(snapshot, expected.optionIds[0], expected.desktopGuestId, null);
  assertParticipantResponse(snapshot, expected.optionIds[1], expected.desktopGuestId, "NO");
  expect(snapshot.options[0]).toMatchObject({ yesCount: 2, noCount: 0 });
  expect(snapshot.options[1]).toMatchObject({ yesCount: 1, noCount: 1 });

  const viewerParticipant = snapshot.participants.find(
    ({ id }) => id === expected.viewerParticipantId,
  );
  if (viewerParticipant === undefined) throw new Error("Viewer participant is absent");
  expect(snapshot.viewer.kind).toBe("guest");
  expect(snapshot.viewer.activeParticipantId).toBe(expected.viewerParticipantId);
  expect(snapshot.viewer.accessibleParticipants).toEqual([viewerParticipant]);
  expect(snapshot.viewer.permissions.canRespond).toBe(true);
}

test("public responsive layouts support complete keyboard-only guest response flows", async ({
  browser,
  ownerPage,
}) => {
  const initial = await test.step("1. Create and bind the active DATE appointment", async () => {
    const created = await createAppointmentThroughWizard(ownerPage, {
      title: TITLE,
      ownerDisplayName: OWNER_NAME,
      type: "DATE",
      optionLimit: 2,
      candidates: [
        { kind: "DATE", startDate: DATE_OPTIONS[0].startDate },
        { kind: "DATE", startDate: DATE_OPTIONS[1].startDate },
      ],
    });
    const snapshot = await readAppointmentSnapshot(ownerPage, created.publicId);
    expect(snapshot.appointment).toEqual({
      publicId: created.publicId,
      title: TITLE,
      description: null,
      type: "DATE",
      status: "ACTIVE",
      optionLimit: 2,
      finalOptionId: null,
      revision: 1,
    });
    expect(snapshot.participants).toHaveLength(1);
    const ownerParticipant = snapshot.participants[0];
    if (ownerParticipant === undefined) throw new Error("Owner participant was not created");
    expect(ownerParticipant.displayName).toBe(OWNER_NAME);
    expect(snapshot.options).toHaveLength(2);
    const firstOption = snapshot.options[0];
    const secondOption = snapshot.options[1];
    if (firstOption === undefined || secondOption === undefined) {
      throw new Error("Creation did not return two options");
    }
    expect(firstOption.id).not.toBe(secondOption.id);
    expect([firstOption, secondOption].map((option) => ({
      creatorParticipantId: option.creatorParticipantId,
      kind: option.kind,
      responses: option.responses,
      startDate: option.kind === "DATE" ? option.startDate : null,
    }))).toEqual(DATE_OPTIONS.map(({ startDate }) => ({
      creatorParticipantId: ownerParticipant.id,
      kind: "DATE",
      responses: [{ participantId: ownerParticipant.id, value: "YES" }],
      startDate,
    })));
    return {
      created,
      initialRevision: snapshot.appointment.revision,
      optionIds: [firstOption.id, secondOption.id] as const,
      ownerParticipantId: ownerParticipant.id,
    };
  });

  let mobileContext: BrowserContext | undefined;
  let desktopContext: BrowserContext | undefined;
  try {
    const publicPages = await test.step("2. Create observed exact-viewport public contexts", async () => {
      mobileContext = await browser.newContext({
        baseURL: E2E_BASE_URL,
        viewport: MOBILE_VIEWPORT,
      });
      await installPointerObserver(mobileContext);
      const mobilePage = await mobileContext.newPage();

      desktopContext = await browser.newContext({
        baseURL: E2E_BASE_URL,
        viewport: DESKTOP_VIEWPORT,
      });
      await installPointerObserver(desktopContext);
      const desktopPage = await desktopContext.newPage();

      expect(mobilePage.viewportSize()).toEqual(MOBILE_VIEWPORT);
      expect(desktopPage.viewportSize()).toEqual(DESKTOP_VIEWPORT);
      await expectNoPointerObservations(mobilePage);
      await expectNoPointerObservations(desktopPage);
      return { desktopPage, mobilePage };
    });

    const mobileGuestName = `Task 55 Mobile ${initial.created.publicId.slice(0, 10)}`;
    const desktopGuestName = `Task 55 Desktop ${initial.created.publicId.slice(10)}`;

    await test.step("3. Prove the 320x800 mobile layout and reach the join form", async () => {
      await publicPages.mobilePage.goto(initial.created.publicUrl);
      await expect(publicPages.mobilePage).toHaveURL(initial.created.publicUrl);
      await expectExactViewportAndNoOverflow(publicPages.mobilePage, MOBILE_VIEWPORT);

      const board = publicPages.mobilePage.getByRole("table", {
        name: TABLE_NAME,
        exact: true,
      });
      await expect(board).toHaveCount(1);
      await expect(board).toBeVisible();
      await expectComputedLayout(board, "block", "board card mode at 320px");
      const rows = board.locator("tbody tr");
      await expect(rows).toHaveCount(2);
      await expectComputedLayout(rows.first(), "flex", "first option card at 320px");
      await expectComputedLayout(rows.nth(1), "flex", "second option card at 320px");
      // Clipped, never display:none: the column headers have to keep their
      // platform accessibility nodes even with no visible columns left.
      const headerRow = await board.locator("thead").evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          display: getComputedStyle(element).display,
          height: bounds.height,
          width: bounds.width,
        };
      });
      expect(headerRow.display, "card-mode thead is not display:none").not.toBe("none");
      expect(headerRow.width, "card-mode thead is clipped to a point").toBeLessThanOrEqual(2);
      expect(headerRow.height, "card-mode thead is clipped to a point").toBeLessThanOrEqual(2);

      const displayName = publicPages.mobilePage.getByLabel("Display name", { exact: true });
      await tabTo(publicPages.mobilePage, displayName, "mobile Display name");
      await expectActiveWithVisibleFocus(displayName, "mobile Display name");
      await publicPages.mobilePage.keyboard.type(mobileGuestName);
      await expect(displayName).toHaveValue(mobileGuestName);
      await expectNoPointerObservations(publicPages.mobilePage);
    });

    const mobileJoin = await test.step("4. Join, save Yes, and expand the mobile card by keyboard", async () => {
      const joinButton = publicPages.mobilePage.getByRole("button", {
        name: "Join appointment",
        exact: true,
      });
      await tabTo(publicPages.mobilePage, joinButton, "mobile Join appointment button");
      await expectActiveWithVisibleFocus(joinButton, "mobile Join appointment button");
      const joinResponsePromise = waitForExactRouteResponse(
        publicPages.mobilePage,
        "POST",
        `/api/appointments/${initial.created.publicId}/participants`,
      );
      await publicPages.mobilePage.keyboard.press("Enter");
      const joinResponse = await joinResponsePromise;
      expect(joinResponse.status()).toBe(201);
      const joinPayload: unknown = await joinResponse.json();
      const joined = joinParticipantSuccessSchema.parse(joinPayload);
      if (!("editUrl" in joined)) throw new Error("Mobile anonymous join returned no edit URL");
      expect(joined.revision).toBe(initial.initialRevision + 1);

      const firstGroup = publicPages.mobilePage.getByRole("group", {
        name: DATE_OPTIONS[0].label,
        exact: true,
      });
      await expect(firstGroup).toBeVisible();
      await expect(unansweredRadioOf(firstGroup)).toBeChecked();

      const unansweredRadio = unansweredRadioOf(firstGroup);
      await tabTo(
        publicPages.mobilePage,
        unansweredRadio,
        "mobile first-option checked Unanswered radio",
      );
      await expectSegmentFocusRing(
        unansweredRadio,
        "mobile first-option checked Unanswered radio",
      );
      const yesRadio = firstGroup.getByRole("radio", { name: "Yes", exact: true });
      await installSegmentActivationFocusObserver(yesRadio);
      const saveResponsePromise = waitForExactRouteResponse(
        publicPages.mobilePage,
        "PUT",
        `/api/appointments/${initial.created.publicId}/responses/${initial.optionIds[0]}`,
      );
      await publicPages.mobilePage.keyboard.press("ArrowRight");
      await expectObservedSegmentActivationFocus(yesRadio, "mobile first-option Yes radio");
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status()).toBe(200);
      const savePayload: unknown = await saveResponse.json();
      const saved = putResponseSuccessSchema.parse(savePayload);
      expect(saved.value).toBe("YES");
      expect(saved.revision).toBe(joined.revision + 1);
      await expect(yesRadio).toBeChecked();
      await expect(
        firstGroup.locator(`[data-save-status="${initial.optionIds[0]}"]`),
      ).toHaveText("Saved");
      await expectNoPointerObservations(publicPages.mobilePage);
      return { joined, saved };
    });

    await test.step("5. Read the whole roster on the phone without opening anything", async () => {
      for (const [index, option] of DATE_OPTIONS.entries()) {
        const row = optionRow(publicPages.mobilePage, option.label);
        await expect(row).toHaveCount(1);
        const chips = row.locator("td[data-ini]");
        await expect(chips).toHaveCount(1);
        await expect(chips.first()).toBeVisible();
        await expectParticipantMark(
          publicPages.mobilePage,
          initial.ownerParticipantId,
          initial.optionIds[index],
          OWNER_NAME,
          "Yes",
        );
      }
      // The viewer answers in the you-cell, so they never also take a column.
      await expect(publicPages.mobilePage.getByRole("columnheader", {
        name: mobileGuestName,
        exact: true,
      })).toHaveCount(0);
      await expectExactViewportAndNoOverflow(publicPages.mobilePage, MOBILE_VIEWPORT);
      await expectNoPointerObservations(publicPages.mobilePage);
    });

    await test.step("6. Prove the 1280x800 desktop table after the mobile save", async () => {
      await publicPages.desktopPage.goto(initial.created.publicUrl);
      await expect(publicPages.desktopPage).toHaveURL(initial.created.publicUrl);
      await expectExactViewportAndNoOverflow(publicPages.desktopPage, DESKTOP_VIEWPORT);

      const table = publicPages.desktopPage.getByRole("table", {
        name: TABLE_NAME,
        exact: true,
      });
      await expect(table).toHaveCount(1);
      await expect(table).toBeVisible();
      await expectComputedLayout(table, "table", "board table mode at 1280px");
      await expect(table.locator("thead")).toBeVisible();
      await expect(table.locator("tbody th[data-option-id]")).toHaveText([
        DATE_OPTIONS[0].label,
        DATE_OPTIONS[1].label,
      ]);
      await expect(
        table.getByRole("columnheader", { name: mobileGuestName, exact: true }),
      ).toHaveCount(1);
      await expectParticipantMark(
        publicPages.desktopPage,
        mobileJoin.joined.participantId,
        initial.optionIds[0],
        mobileGuestName,
        "Yes",
      );
      await expectNoPointerObservations(publicPages.desktopPage);
    });

    const desktopJoin = await test.step("7. Join and save No in the desktop flow by keyboard", async () => {
      const displayName = publicPages.desktopPage.getByLabel("Display name", { exact: true });
      await tabTo(publicPages.desktopPage, displayName, "desktop Display name");
      await expectActiveWithVisibleFocus(displayName, "desktop Display name");
      await publicPages.desktopPage.keyboard.type(desktopGuestName);
      await expect(displayName).toHaveValue(desktopGuestName);

      const joinButton = publicPages.desktopPage.getByRole("button", {
        name: "Join appointment",
        exact: true,
      });
      await tabTo(publicPages.desktopPage, joinButton, "desktop Join appointment button");
      await expectActiveWithVisibleFocus(joinButton, "desktop Join appointment button");
      const joinResponsePromise = waitForExactRouteResponse(
        publicPages.desktopPage,
        "POST",
        `/api/appointments/${initial.created.publicId}/participants`,
      );
      await publicPages.desktopPage.keyboard.press("Enter");
      const joinResponse = await joinResponsePromise;
      expect(joinResponse.status()).toBe(201);
      const joinPayload: unknown = await joinResponse.json();
      const joined = joinParticipantSuccessSchema.parse(joinPayload);
      if (!("editUrl" in joined)) throw new Error("Desktop anonymous join returned no edit URL");
      expect(joined.revision).toBe(mobileJoin.saved.revision + 1);

      const secondGroup = publicPages.desktopPage.getByRole("group", {
        name: DATE_OPTIONS[1].label,
        exact: true,
      });
      await expect(unansweredRadioOf(secondGroup)).toBeChecked();
      const unansweredRadio = unansweredRadioOf(secondGroup);
      await tabTo(
        publicPages.desktopPage,
        unansweredRadio,
        "desktop second-option checked Unanswered radio",
      );
      await expectSegmentFocusRing(
        unansweredRadio,
        "desktop second-option checked Unanswered radio",
      );
      const noRadio = secondGroup.getByRole("radio", { name: "No", exact: true });
      await installSegmentActivationFocusObserver(noRadio);
      const saveResponsePromise = waitForExactRouteResponse(
        publicPages.desktopPage,
        "PUT",
        `/api/appointments/${initial.created.publicId}/responses/${initial.optionIds[1]}`,
      );
      await publicPages.desktopPage.keyboard.press("ArrowLeft");
      await expectObservedSegmentActivationFocus(noRadio, "desktop second-option No radio");
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status()).toBe(200);
      const savePayload: unknown = await saveResponse.json();
      const saved = putResponseSuccessSchema.parse(savePayload);
      expect(saved.value).toBe("NO");
      expect(saved.revision).toBe(joined.revision + 1);
      await expect(noRadio).toBeChecked();
      await expect(
        secondGroup.locator(`[data-save-status="${initial.optionIds[1]}"]`),
      ).toHaveText("Saved");
      await expectParticipantMark(
        publicPages.desktopPage,
        mobileJoin.joined.participantId,
        initial.optionIds[0],
        mobileGuestName,
        "Yes",
      );
      await expectExactViewportAndNoOverflow(publicPages.desktopPage, DESKTOP_VIEWPORT);
      await expectNoPointerObservations(publicPages.desktopPage);
      return { joined, saved };
    });

    await test.step("8. Bind both final snapshots, response graph, viewers, and pointer boundary", async () => {
      const [mobileSnapshot, desktopSnapshot] = await Promise.all([
        readAppointmentSnapshot(publicPages.mobilePage, initial.created.publicId),
        readAppointmentSnapshot(publicPages.desktopPage, initial.created.publicId),
      ]);
      const expectedBase = {
        desktopGuestId: desktopJoin.joined.participantId,
        desktopGuestName,
        finalRevision: desktopJoin.saved.revision,
        mobileGuestId: mobileJoin.joined.participantId,
        mobileGuestName,
        optionIds: initial.optionIds,
        ownerParticipantId: initial.ownerParticipantId,
        publicId: initial.created.publicId,
      } as const;
      assertFinalSnapshot(mobileSnapshot, {
        ...expectedBase,
        viewerParticipantId: mobileJoin.joined.participantId,
      });
      assertFinalSnapshot(desktopSnapshot, {
        ...expectedBase,
        viewerParticipantId: desktopJoin.joined.participantId,
      });
      expect(desktopSnapshot.appointment.revision).toBe(desktopJoin.saved.revision);
      expect(mobileSnapshot.appointment).toEqual(desktopSnapshot.appointment);
      expect(mobileSnapshot.participants).toEqual(desktopSnapshot.participants);
      expect(mobileSnapshot.options).toEqual(desktopSnapshot.options);
      await expectNoPointerObservations(publicPages.mobilePage);
      await expectNoPointerObservations(publicPages.desktopPage);
    });
  } finally {
    await Promise.allSettled(
      [desktopContext, mobileContext]
        .filter((context): context is BrowserContext => context !== undefined)
        .map((context) => context.close()),
    );
  }
});
