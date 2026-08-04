# Task 51: Test option and participant boundaries

## Files

Add `e2e/boundaries.spec.ts`, `e2e/database-helpers.ts`, and `.superpowers/sdd/appointly-mvp-plan/task-51-report.md`.

## Scenario contract

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option and an option limit of 3. Keep the generated public ID and initial option ID from a schema-validated snapshot.
2. Use the anonymous `page` fixture to join through the visible form. Parse the exact participant POST response and wait for its suggestion controls.
3. Reach the option limit through visible controls. Submit two distinct future DATE suggestions with exact pre-trigger options POST waits and `addOptionSuccessSchema` parsing. After the first, require `Suggestion added.` and a refreshed form. After the second, require exactly three visible options, no suggestion form, and the exact `Option limit reached. No more suggestions can be added.` status. A schema-validated snapshot must contain the three returned identities and canonical dates at the final route revision.
4. Add a Node-only E2E database helper that opens `.tmp/e2e.sqlite` through the shared database connection API, resolves only the generated appointment by public ID, counts its existing participants, and inserts safe unique UUIDv4 guest rows until the exact requested count. Normalize names with the production helper, use one SQLite transaction, keep foreign keys enabled, and always close the connection. It must reject a missing appointment, a target below the current count, and any target outside 1–200. Do not mutate appointment revision or any unrelated row.
5. Use that helper to bring this appointment to exactly 199 participants. Confirm the helper result is 199.
6. Create a fresh anonymous browser context with no guest-session cookie. Open the generated public URL and join once through the visible form to reach 200. Begin the exact participant POST wait before the click, require HTTP 201, parse `joinParticipantSuccessSchema`, and require a revision beyond the option-limit revision. Confirm the helper now counts exactly 200.
7. Create another fresh anonymous browser context with no guest-session cookie. Open the same public URL, submit one more unique name through the visible Join form, and require HTTP 409. Parse the shared join-route error schema and require exact code `PARTICIPANT_LIMIT_REACHED` and message `This appointment already has 200 participants.`. Prove the result is not `RATE_LIMITED`, the visible form announces the same message, and the helper still counts exactly 200.
8. Close both created contexts in `finally`, including partial-failure paths.

## Quality boundary

Use shared fixtures, creation helpers, schemas, accessible locators, and exact pre-trigger waits. The direct database helper is allowed only for the 199-participant setup and count confirmation. Use no sleeps, fixed public IDs, direct appointment creation APIs, production edits, forwarded-header trust changes, unrelated limit checks, or commits.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in the report.