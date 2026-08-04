# Task 50: Test cross-context SSE live updates

## Scenario contract

Add one focused Playwright scenario at `e2e/cross-context-sse.spec.ts`.

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option and an option limit of 3. Keep the real public ID and initial option ID from a schema-validated snapshot.
2. Load the public appointment in the authenticated owner page and prove its exact `/events` EventSource request opens. After this initial load, observe main-frame navigation and document requests so any reload is detected.
3. Use the isolated anonymous `page` fixture to join through the visible form. Parse the exact participant POST success and wait for the guest's response and suggestion controls. Keep the guest participant ID and display name.
4. Before the guest votes Yes on the initial option, start an owner-page exact snapshot GET wait that schema-parses candidates and continues until it sees a newer revision containing that guest's `YES` response. Begin the guest's exact response PUT wait before checking Yes, require HTTP 200, parse `putResponseSuccessSchema`, and then require the owner wait to resolve at the same revision or newer.
5. Without reloading the owner page, prove its visible shared ledger now contains exactly one guest row whose initial-option cell reads `Yes`.
6. Before the guest suggests a second distinct future date, start another owner-page schema-filtered exact snapshot GET wait. Its state predicate must identify the canonical suggested date, the guest creator, and the creator's automatic `YES` response without depending on a response body that is not known yet. Submit through the visible suggestion form with an exact pre-trigger options POST wait. Require HTTP 201 and parse `addOptionSuccessSchema`.
7. Require the owner snapshot to contain the returned option ID at the add-option revision or newer. Without reloading, prove the owner UI shows the suggested date in its public option layout and shared ledger, with the guest cell equal to `Yes`.
8. Require the owner URL to remain the public URL, zero observed main-frame navigations, and zero document requests after observation started. Read a final owner snapshot to prove both mutations persist with the expected participant and option identities.
9. Remove request and frame listeners in `finally`. Fixture-owned contexts need no manual close.

## Quality boundary

Use shared E2E fixtures, creation helpers, route schemas, accessible locators, and schema-filtered snapshot waits. Start every wait before its trigger. Use no sleeps, page reloads, fixed public IDs, direct creation APIs, database access, production edits, or unrelated permission checks.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in `.superpowers/sdd/appointly-mvp-plan/task-50-report.md`.