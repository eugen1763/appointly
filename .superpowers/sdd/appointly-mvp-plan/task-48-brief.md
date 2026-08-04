# Task 48: Test guest-link reset and access revocation

## Scenario contract

Add one focused Playwright scenario at `e2e/guest-link-reset.spec.ts`.

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option. Keep its real public ID and option ID.
2. Use the anonymous `page` fixture to join through the visible public form. Capture the one-time private edit href in memory, and save a visible Yes response. Validate route success bodies through the shared Zod contracts and record the participant ID and revision.
3. Before reset, begin a wait in the guest page for the exact participant-selection snapshot refresh caused by the reset SSE event. From `ownerPage`, call the same-origin reset route `POST /api/appointments/{publicId}/participants/{participantId}/reset-link` with no body. Require HTTP 200 and parse `resetParticipantLinkSuccessSchema`. Prove it returns the same participant, a different private href, and a larger revision.
4. Await the old guest page's live snapshot refresh. Parse it with `appointmentSnapshotSchema` and prove that the viewer has no active or accessible participant and cannot respond. Prove the visible response controls disappear and the Join form returns. Then call the response route from that old browser with the old participant ID and require stable HTTP 403 `FORBIDDEN`.
5. Open the old private href in a fresh anonymous context. Begin the exact guest-access POST response wait before navigation. Require HTTP 403 with stable `INVALID_EDIT_LINK`, a fragment-free edit URL after the fragment is consumed, and the visible `Link unavailable` state. Do not print or persist the private token.
6. Open the new private href in another fresh anonymous context. Begin the exact guest-access POST response wait before navigation. Require HTTP 200, parse `guestAccessSuccessSchema`, require the same participant ID, wait for the fragment-free public appointment URL, and prove the saved participant region and exact Yes response remain.
7. Read a schema-validated snapshot in the restored context and prove the participant row remains unique, its display name is unchanged, and the original option still contains the same participant's `YES` response.
8. Close every created browser context in `finally`, including partial-failure paths.

## Quality boundary

Use shared E2E fixtures, creation helpers, route schemas, and browser-visible locators. Start every network wait before its trigger. Use no sleeps, fixed public IDs, direct creation APIs, database access, production edits, unrelated scenarios, or token logging. Do not weaken assertions to avoid a real failure.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in `.superpowers/sdd/appointly-mvp-plan/task-48-report.md`.