# Task 44: Test all four option types in browser

Add Playwright coverage that creates one appointment of each exact option type through the real creation wizard. Assert both the snapshot storage values and the public page labels.

## Required files

- Add a reusable `e2e/appointment-helpers.ts` for creation and snapshot reads.
- Add `e2e/option-types.spec.ts` with the four scenarios.
- Do not change production files, fixture authentication, Playwright config, package scripts, or earlier tests.

## Creation helper contract

- Export a typed helper that accepts a Playwright `Page`, title, exact type, option limit, optional co-organizer emails, and one or more type-matched candidates.
- The candidate union must preserve the exact four shapes: `DATE`, `DATE_TIME`, `DATE_RANGE`, and `DATE_TIME_RANGE`.
- Drive `/appointments/new` only through accessible labels and role locators.
- Fill the title, owner display name when supplied, type, option limit, optional co-organizer emails, and every candidate.
- Click `Continue to options`, add each candidate, and click `Create appointment`.
- Wait for the read-only `Public appointment link` input. Validate that its value is an `http://127.0.0.1:3000/a/{24-character-base64url}` URL.
- Return the public URL and public ID. Do not call the appointment creation API directly.
- Export a snapshot helper that calls the real `/api/appointments/{publicId}/snapshot` endpoint through `page.request`, requires HTTP 200, and parses the result with `appointmentSnapshotSchema`.
- Use top-level `import type` declarations for every type-only dependency.

## Scenario contract

Use the authenticated `ownerPage` fixture. Create four unique appointments. One Playwright test per type is preferred so each failure identifies its contract.

1. `DATE`: submit `2030-04-03`. Assert snapshot type and exact `startDate`. Open the public URL and assert the H1, `Day` type label, and visible desktop option label `April 3, 2030`.
2. `DATE_TIME`: submit `2030-04-03T09:30`. Compute its expected Unix milliseconds in the same browser context from the local input. Assert snapshot type and exact `startAt`. Open the public URL, wait for client time formatting, and assert the visible desktop label equals that context's `Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })` output. Assert the displayed time-zone marker equals the browser context's resolved time zone.
3. `DATE_RANGE`: submit `2030-04-03` through `2030-04-05`. Assert exact snapshot start/end dates. Assert the visible desktop label is `April 3, 2030 – April 5, 2030`.
4. `DATE_TIME_RANGE`: submit `2030-04-03T09:30` through `2030-04-03T11:00`. Compute both expected instants in the browser context. Assert exact snapshot start/end milliseconds. Assert the visible desktop label equals the two browser-formatted times joined by ` – `. Assert the displayed time-zone marker.

For every scenario, assert there is exactly one option, its `kind` equals the appointment type, and the appointment title and type match. Target the visible desktop option header with `data-view="desktop"` and the snapshot option ID so the hidden mobile duplicate cannot weaken the assertion.

## Quality boundary

- Reuse `e2e/fixtures.ts`; keep the anonymous `page` fixture unchanged.
- Keep date-only assertions zone-independent. Do not convert a calendar date through `Date`.
- Derive timed expectations independently in the live browser. Do not import the production time formatter or time conversion helper into the spec.
- Do not use sleeps, raw CSS positional selectors, direct database writes, fixed public IDs, broad text matches, or API appointment creation.
- Do not add Task 45 zone comparison, guest, co-organizer, SSE, boundary, finalization, deletion, or responsive scenarios.
- Write `.superpowers/sdd/appointly-mvp-plan/task-44-report.md` with files, contracts, and coordinator validation.
- Skip formatter, linter, TypeScript, builds, browser commands, all tests, and commits. The coordinator validates and commits.
