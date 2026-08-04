# Task 51 Report

## Files

- Added `e2e/boundaries.spec.ts` with one exact option-cap and participant-cap browser scenario.
- Added `e2e/database-helpers.ts` with scoped participant seeding and count helpers for `.tmp/e2e.sqlite`.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-51-report.md`.
- No production file or existing test was changed.

## Eight-step scenario

1. The shared authenticated `ownerPage` drives `createAppointmentThroughWizard` to create one active DATE appointment with a generated public ID, one future canonical date, and an option limit of three. A schema-validated snapshot captures the initial option ID and creation revision and proves the exact appointment boundary.
2. The anonymous `page` opens the generated public URL and joins through the visible labeled form. Its exact participant-route POST wait is installed before the click, requires HTTP 201, parses `joinParticipantSuccessSchema`, proves the anonymous private-link result, and retains the join revision.
3. The guest submits two distinct future DATE suggestions through the visible suggestion form. Each exact options-route POST wait starts before its click, requires HTTP 201, and parses `addOptionSuccessSchema`. After the first response the exact `Suggestion added.` status, the refreshed empty form, and the returned option's visible response group are required. After the second response, the `Your response` region must expose exactly three option groups, the suggestion form must be absent, and the exact option-limit status must be visible. A final schema-validated snapshot is pinned to the second add-option revision and requires the captured initial ID plus both returned IDs in canonical date order.
4. `seedAppointmentParticipants` validates the public-ID contract and the integer target range 1–200, opens only `.tmp/e2e.sqlite` through `createDatabaseConnection`, confirms foreign keys are enabled, resolves only the generated appointment, and performs the count, UUIDv4 row construction, normalized-name insertion, and exact post-insert count in one immediate SQLite transaction. It rejects a missing appointment and a target below the current count. Both exported helpers close their isolated connection in `finally`; neither updates appointment revision nor any unrelated row.
5. The database helper alone advances the generated appointment to exactly 199 participants, and its returned count must equal 199.
6. A newly created anonymous browser context is proven to have no `appointly_guest_session` cookie before and after loading the generated public URL. It joins through the visible form with an exact pre-click participant POST wait, requires HTTP 201, parses `joinParticipantSuccessSchema`, requires a revision beyond the option-limit revision, verifies the canonical guest-session cookie produced by success, and confirms an exact database count of 200.
7. A second newly created anonymous browser context is likewise proven cookie-free before and after public-page load. Its unique visible-form submission requires HTTP 409 and parses the shared join-route error schema. The body must be exactly `PARTICIPANT_LIMIT_REACHED` with `This appointment already has 200 participants.`, is explicitly not `RATE_LIMITED`, is announced identically by the visible form alert, creates no guest-session cookie, and leaves the exact count at 200.
8. Both manually created contexts are closed concurrently in `finally`, including partial-failure paths. Fixture-owned contexts remain fixture-managed.

## Boundaries

The scenario uses no sleep, fixed public ID, direct creation API, production edit, unrelated database mutation, forwarded-header change, browser command, or commit. Database access is limited to the allowed 199-participant setup and exact participant-count confirmations.

## Coordinator validation

- Focused Playwright validation: 1 test passed in Chromium.
- `tsc --noEmit`: exited zero.
- Task review: clean, with no Critical or Important finding.
