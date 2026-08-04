# Task 50 Report

## Files

- Added `e2e/cross-context-sse.spec.ts` with one focused cross-context live-update scenario.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-50-report.md`.
- No production files or existing tests were changed.

## Scenario assertions

The scenario uses the shared authenticated `ownerPage` and isolated anonymous `page` fixtures. It creates one active DATE appointment through `createAppointmentThroughWizard`, with one future date and an option limit of three. A schema-validated owner snapshot proves the generated public ID, active status, exact initial revision, option contract, initial option ID, and authenticated owner participant binding before either public context is loaded.

Before the owner opens the generated public URL, the scenario installs exact waits for the appointment's GET event stream and the EventSource open-time snapshot repair. It proves the opened request has the exact `/api/appointments/{publicId}/events` URL, GET method, Playwright `eventsource` resource type, non-navigation status, HTTP 200 response, and exact event-stream content type. The schema-filtered initial repair must retain the creation revision and exact owner participant ID. Only after this initial public load and repair complete does the test attach main-frame-navigation and document-request observers.

The anonymous context then opens the generated public URL and joins through the visible labeled form. Its exact participant POST wait starts before the click, requires HTTP 201, parses `joinParticipantSuccessSchema`, proves the anonymous result includes a private edit link, and retains the guest participant ID, generated display name, and join revision. The test waits for the initial-date response group and suggestion form to be visibly available.

Before the guest checks the visible Yes radio, the test starts both the owner's exact snapshot GET wait and the guest's exact initial-option response PUT wait. The guest mutation requires HTTP 200 and parses `putResponseSuccessSchema` as `YES`. The owner wait schema-parses every exact-route candidate and rejects snapshots unless their revision is newer than the guest join and their state binds the exact guest ID and display name to a `YES` response on the exact initial option ID. This prevents an initial-open, join, or unrelated reconnect snapshot from satisfying the wait. The matching owner snapshot must be at the response mutation revision or newer. Without reloading, the visible owner ledger must contain exactly one row for the guest, and its initial-option/guest cell must read `Yes`.

Before the guest submits the second distinct future DATE through the visible suggestion form, the test starts the owner's second exact schema-filtered snapshot wait and the guest's exact options POST wait. The owner predicate is intentionally independent of the not-yet-known POST body: it requires a revision newer than the saved response plus the canonical suggested date, exact guest creator, and that creator's automatic `YES`. The POST requires HTTP 201 and parses `addOptionSuccessSchema`. The matching owner snapshot must be at the add-option revision or newer and must contain the returned option ID with the same canonical date, creator ID, and automatic response.

After the suggestion refresh, the already-loaded owner page must visibly expose the canonical suggested date in its response-option layout and in the shared ledger header. The same exact guest row must show `Yes` in the returned option ID/guest participant ID cell.

A final schema-validated owner snapshot requires the appointment revision to equal the returned add-option revision, the viewer to remain bound to the original owner participant, and exactly one participant match by both guest ID and guest display name. Its stable option identities must be exactly the captured initial option ID followed by the returned suggested option ID. The initial option retains that guest's `YES`; the suggested option retains the canonical date, exact guest creator, exactly that guest's automatic `YES`, and the expected response totals.

## SSE synchronization and no-reload evidence

Both mutation-specific owner waits are installed before their guest triggers. They match only an exact authenticated-owner snapshot URL including the owner participant selection, require HTTP 200, parse with `appointmentSnapshotSchema`, advance past a mutation-specific revision floor, and require the mutation's complete identity-bound state. Therefore stale initial-open, join, or reconnect snapshots cannot satisfy either wait.

The owner URL is required to remain the generated public URL after both mutations. From the completed initial EventSource repair through the final visible assertions, the owner must record zero main-frame navigations and zero document requests. The only synchronization is route responses, schema-qualified SSE-triggered snapshot responses, and visible locator assertions; there are no sleeps or reloads.

## Teardown and boundaries

The owner request and frame listeners are removed in `finally`, including assertion-failure paths. Fixture-owned contexts are not manually closed. The scenario uses no fixed public ID, direct creation API, database access, production change, unrelated permission check, browser command, or commit.

## Coordinator validation

- Focused Playwright validation: 1 test passed in Chromium.
- `tsc --noEmit`: exited zero.
- Task review: clean, with no Critical or Important finding.
