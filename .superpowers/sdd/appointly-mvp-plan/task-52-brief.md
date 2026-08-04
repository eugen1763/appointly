# Task 52: Test option deletion ownership rules

## Files

Add `e2e/option-deletion-ownership.spec.ts` and `.superpowers/sdd/appointly-mvp-plan/task-52-report.md`.

## Scenario contract

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option and room for one suggestion. Capture the owner participant ID, initial option ID, and initial revision from a schema-validated owner snapshot.
2. Use the anonymous `page` fixture to join as participant A through the visible form. Capture its exact participant ID and revision from the schema-validated POST response.
3. Participant A suggests one distinct future DATE option through the visible form. Begin the exact options POST wait before its click, parse `addOptionSuccessSchema`, and capture the returned option ID and revision. Prove through the refreshed participant-A UI and snapshot that only this returned option is exposed in `Delete an option`, has `creatorParticipantId` equal to participant A, has participant A's automatic YES response, and has `canDelete: true`.
4. Create a fresh anonymous browser context in `try`/`finally`, join as participant B through the visible form, and capture its different participant ID from the exact schema-validated POST response. In participant B's current UI and snapshot, require the participant-A option to persist with `canDelete: false`, and require no deletion control for it.
5. From participant B's same-origin page, attempt the exact option DELETE route with participant B's own ID. Require HTTP 403 and parse the shared delete-route error schema. Require exact code `FORBIDDEN` and message `Only the participant who suggested this option can delete it.`.
6. Refresh the already authenticated owner page to current state. The owner snapshot must bind the owner participant ID, retain the participant-A option with `canDelete: false`, and expose no deletion control for that option. The owner may still see a control for the owner-created initial option; distinguish controls by `data-delete-option`.
7. From the owner's same-origin page, attempt the same exact option DELETE route with the owner's own participant ID. Require the same HTTP 403, schema-valid `FORBIDDEN` body, and exact ownership message.
8. Read a final schema-validated snapshot. Both denied attempts must leave the appointment revision unchanged from the participant-B join revision, retain both exact option identities, retain participant A as the suggestion creator and sole YES responder, and leave participant A's own delete control available when its page refreshes. Close the participant-B context in `finally`, including failure paths.

## Quality boundary

Use shared fixtures, creation helpers, route schemas, accessible locators, exact pre-trigger waits, and generated identities. Direct same-origin fetch is allowed only for the two forbidden DELETE proofs because the corresponding UI controls must be absent. Use no sleeps, fixed public IDs, direct creation API, database access, production edits, unrelated permission checks, browser commands, or commits.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in the report.