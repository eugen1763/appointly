# Task 45: Test timed and date-only zones

Add Playwright coverage that renders the same timed appointment in `UTC` and `America/New_York`, and proves the same date-only value does not shift.

## Required files

- Add `e2e/time-zones.spec.ts`.
- Reuse `e2e/appointment-helpers.ts` and `e2e/fixtures.ts` without modifying them.
- Add `.superpowers/sdd/appointly-mvp-plan/task-45-report.md`.
- Do not change production files, Playwright config, fixture authentication, package scripts, or earlier E2E specs.

## Scenario contract

Use one focused test with the authenticated `ownerPage` and standard Playwright `browser` fixtures.

1. Create one `DATE_TIME` appointment through `createAppointmentThroughWizard` with a unique title, option limit 1, and local candidate `2030-04-03T01:30`.
2. Read its real snapshot. Require one option of kind `DATE_TIME` and retain its stored `startAt` and option ID.
3. Create one `DATE` appointment through the wizard with a unique title, option limit 1, and `2030-04-03`.
4. Read its snapshot. Require one option of kind `DATE`, exact `startDate: "2030-04-03"`, and retain its option ID.
5. Create two independent anonymous browser contexts with `locale: "en-US"`: one with `timezoneId: "UTC"`, one with `timezoneId: "America/New_York"`. Create one page in each. Close both contexts in `finally` blocks.
6. Open the same timed public URL in both pages. Target the visible desktop option header using `data-view="desktop"` and the real option ID.
7. In each browser page, independently format the stored `startAt` using `Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })`. Assert the app's visible `<time>` text equals that page's expected label.
8. Assert the time-zone marker equals `UTC` in the UTC page and `America/New_York` in the New York page. Assert the two timed labels differ.
9. Open the same date-only public URL in both pages. Target the visible desktop option header using its real option ID.
10. Assert both pages show exactly `April 3, 2030`. Assert each `<time>` has `datetime="2030-04-03"`. Do not use `Date` or a time zone conversion for this value.

## Quality boundary

- Creation must use the real wizard helper. Do not create appointments through an API or database helper.
- Contexts must stay anonymous. The public page must not depend on copied owner storage state.
- The expected timed label must derive in each live browser context from the stored instant. Do not import the production formatter.
- Use condition-based Playwright assertions. Do not use sleeps, screenshots, or broad text matches.
- Keep both context pages on the same appointment before comparing their values.
- Do not add co-organizer, guest, SSE, boundary, deletion, finalization, or responsive scenarios.
- Record files, exact assertions, context cleanup, and coordinator validation in the report.
- Skip formatter, linter, TypeScript, builds, browser commands, all tests, and commits. The coordinator validates and commits.
