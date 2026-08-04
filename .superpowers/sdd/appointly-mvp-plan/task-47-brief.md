# Task 47: Test guest return and response editing

Add Playwright coverage for a guest joining without an account, saving all three response states, copying the private edit link, opening it in a fresh context, and editing the same participant.

## Required files

- Add `e2e/guest-return-response.spec.ts`.
- Reuse existing E2E helpers, auth constants, and fixtures without modifying them.
- Add `.superpowers/sdd/appointly-mvp-plan/task-47-report.md`.
- Do not change production files, Playwright config, fixture setup, package scripts, or earlier E2E specs.

## Scenario setup

Use one focused test with `ownerPage`, anonymous `page`, and `browser`.

1. The owner creates a `DATE` appointment through `createAppointmentThroughWizard` with title `Task 47 guest return`, option limit 3, and these candidates in order: `2030-04-03`, `2030-04-04`, and `2030-04-05`.
2. Read the owner snapshot. Require exactly three ordered DATE options and retain their real option IDs.
3. Navigate the anonymous `page` to the public URL. Assert it remains anonymous and shows the `Join appointment` form.
4. Fill `Display name` with `Task 47 Returning Guest` and submit `Join appointment`.
5. Wait for `Save your private edit link`. Capture the exact `Private edit link` href. Validate that it uses the created public ID, the `/edit` path, and exactly one `participant` plus one non-empty `token` fragment parameter.
6. Grant `clipboard-read` and `clipboard-write` only for `E2E_BASE_URL`. Click `Copy private link`, wait for exact status `Private link copied.`, read the clipboard, and assert it equals the captured href.

## Initial responses

Scope every response control to the fieldset/group named by its exact date label. Use a helper that starts a `page.waitForResponse` for the exact PUT response route before selecting a radio, requires HTTP 200, validates the returned value/revision, then waits for the chosen radio and `Saved` state.

- `April 3, 2030`: select `Yes`.
- `April 4, 2030`: select `No`.
- `April 5, 2030`: select `Yes`, then select `Unanswered`. The second write must return `value: null` and proves response clearing instead of relying on the initial default.

Read the guest snapshot. Require the active participant ID to match the edit-link participant ID. Require exactly one participant with display name `Task 47 Returning Guest`. For that participant, assert the first option has `YES`, the second has `NO`, and the third has no response row.

## Fresh-context return

1. Create a new anonymous browser context with `baseURL: E2E_BASE_URL`. Do not load any storage state or copy any cookies/local storage. Close it in `finally`.
2. Open the captured private edit URL in its new page. Wait for redirect to the exact public URL with no fragment. Assert the saved-participant region says `Returning as Task 47 Returning Guest`.
3. Read the snapshot through the fresh page. Require the same active participant ID and the same display name. Assert there is still exactly one participant with that display name.
4. Update the responses through the visible controls: first option to `No`, second to `Unanswered`, and third to `Yes`. Validate each PUT response as above.
5. Read the final fresh-context snapshot. Require the same participant ID and one same-name participant. Assert their final responses are first `NO`, second absent, and third `YES`. No new participant row may appear.

## Quality boundary

- Creation and join must use the real UI. Private access must use the real fragment exchange route and redirect.
- Response changes must use visible radios and exact network completion. Do not call response APIs directly.
- A selected initial `Unanswered` state is not sufficient. Exercise an actual clear write.
- Do not inspect or log the private token. Only validate its non-empty presence and compare the complete href in memory.
- Do not use sleeps, direct database access, fixed participant IDs, broad text matches, or copied session state.
- Do not add link reset, SSE, suggestion, boundary, deletion, finalization, or responsive scenarios.
- Record files, private-link copy proof, initial/final responses, identity continuity, and coordinator validation in the report.
- Skip formatter, linter, TypeScript, builds, browser commands, all tests, and commits. The coordinator validates and commits.
