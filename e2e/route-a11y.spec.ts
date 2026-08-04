import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { createAppointmentThroughWizard, openManageTools } from "./appointment-helpers";
import { expect, test } from "./fixtures";

const DESKTOP = { width: 1280, height: 800 } as const;
const PHONE = { width: 390, height: 844 } as const;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] as const;

/**
 * Switching the colour scheme starts the colour transitions, and axe samples
 * whatever is painted at that instant: scanning immediately reads interpolated
 * colours and reports a contrast failure that no settled state ever shows (the
 * sign-in button read 2.86:1 mid-fade against 7.35:1 settled). Longer than the
 * slowest transition in the app.
 */
const TRANSITION_SETTLE_MS = 700;

/**
 * Landmark and heading rules are tagged best-practice, so they do not run under
 * the WCAG tags and have to be asked for by name. withRules replaces tag
 * filtering rather than adding to it, which is why every surface takes two scans.
 */
const STRUCTURE_RULES = [
  "landmark-one-main",
  "region",
  "heading-order",
  "landmark-unique",
  "page-has-heading-one",
  "empty-heading",
] as const;

interface AxeResultLike {
  readonly id: string;
  readonly help?: string;
  readonly nodes: readonly { readonly target: readonly unknown[]; readonly failureSummary?: string }[];
}

/** Readable failures: an id alone does not say which element or why. */
function describe(results: readonly AxeResultLike[]): string[] {
  return results.flatMap((result) => result.nodes.map((node) => (
    `${result.id} @ ${JSON.stringify(node.target)} — ${(node.failureSummary ?? result.help ?? "").replace(/\s+/gu, " ").trim()}`
  )));
}

const incompleteLog: string[] = [];

function recordIncomplete(label: string, results: readonly AxeResultLike[]): void {
  for (const line of describe(results)) incompleteLog.push(`${label}: ${line}`);
}

/**
 * Scans one surface in both colour schemes. Only `violations` gates: `incomplete`
 * is axe saying it could not decide, which is not a defect, so it is logged for
 * the record instead of failing the run.
 */
async function scan(page: Page, label: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(TRANSITION_SETTLE_MS);

    const wcag = await new AxeBuilder({ page }).withTags([...WCAG_TAGS]).analyze();
    expect(describe(wcag.violations), `${label} — ${colorScheme} — WCAG A/AA`).toEqual([]);
    recordIncomplete(`${label} ${colorScheme} wcag`, wcag.incomplete);

    const structure = await new AxeBuilder({ page }).withRules([...STRUCTURE_RULES]).analyze();
    expect(describe(structure.violations), `${label} — ${colorScheme} — structure`).toEqual([]);
    recordIncomplete(`${label} ${colorScheme} structure`, structure.incomplete);
  }
  await page.emulateMedia({ colorScheme: "light" });
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

test("every route passes axe in both colour schemes", async ({
  browserName,
  ownerPage,
  page,
}) => {
  test.skip(
    browserName !== "chromium",
    "axe contrast results drift across engines; board-a11y.spec.ts is the cross-engine truth",
  );
  test.setTimeout(300_000);

  await page.setViewportSize(DESKTOP);
  await ownerPage.setViewportSize(DESKTOP);

  await page.goto("/");
  await scan(page, "/ (anonymous)");

  await page.goto("/sign-in");
  await scan(page, "/sign-in (anonymous)");

  await ownerPage.goto("/appointments/new");
  await scan(ownerPage, "/appointments/new (owner)");

  const created = await createAppointmentThroughWizard(ownerPage, {
    title: "Phase 6 route a11y",
    optionLimit: 4,
    ownerDisplayName: "Route A11y Owner",
    type: "DATE",
    candidates: [
      { kind: "DATE", startDate: "2029-09-11" },
      { kind: "DATE", startDate: "2029-09-12" },
    ],
  });

  // A guest Yes puts one option strictly ahead, so the board and the dashboard
  // card both render their leading treatment rather than an untouched board.
  await page.goto(created.publicUrl);
  await joinAs(page, "Route A11y Guest");
  const firstGroup = page.getByRole("group", { name: "September 11, 2029", exact: true });
  const saved = page.waitForResponse((response) => (
    response.request().method() === "PUT"
    && new URL(response.url()).pathname.includes("/responses/")
  ));
  await firstGroup.getByRole("radio", { name: "Yes", exact: true }).check();
  expect((await saved).status()).toBe(200);
  await expect(firstGroup.locator("[data-save-status]")).toHaveText("Saved");
  await expect(page.getByText("LEADING", { exact: true })).toBeVisible();

  await scan(page, "public appointment (guest joined, 1280)");
  await page.setViewportSize(PHONE);
  await scan(page, "public appointment (guest joined, 390 card mode)");
  await page.setViewportSize(DESKTOP);

  await ownerPage.goto("/dashboard");
  await expect(ownerPage.getByRole("link", { name: "Phase 6 route a11y", exact: true }).first())
    .toBeVisible();
  await scan(ownerPage, "/dashboard (owner, populated card)");

  await ownerPage.goto(created.publicUrl);
  await openManageTools(ownerPage);
  await ownerPage.getByRole("button", { name: "Add an option", exact: true }).click();
  await expect(ownerPage.locator("#add-option-panel")).toBeVisible();
  await scan(ownerPage, "public appointment (owner, manage + add panels open)");

  await page.goto(`/a/${created.publicId}/edit`);
  await expect(page.getByRole("heading", { name: "Link unavailable", exact: true })).toBeVisible();
  await scan(page, "/a/{publicId}/edit (failure state)");

  // The delete dialog is modal, so `region` rightly ignores its content: WCAG
  // tags only here.
  await ownerPage.goto(created.publicUrl);
  await ownerPage.getByRole("button", { name: "Delete an option", exact: true }).first().click();
  const dialog = ownerPage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await ownerPage.emulateMedia({ colorScheme });
    await ownerPage.waitForTimeout(TRANSITION_SETTLE_MS);
    const wcag = await new AxeBuilder({ page: ownerPage }).withTags([...WCAG_TAGS]).analyze();
    expect(describe(wcag.violations), `delete dialog — ${colorScheme} — WCAG A/AA`).toEqual([]);
    recordIncomplete(`delete dialog ${colorScheme} wcag`, wcag.incomplete);
  }
  await ownerPage.emulateMedia({ colorScheme: "light" });

  console.log(`AXE INCOMPLETE (${incompleteLog.length} entries, not gated):`);
  for (const line of incompleteLog) console.log(`  ${line}`);
});
