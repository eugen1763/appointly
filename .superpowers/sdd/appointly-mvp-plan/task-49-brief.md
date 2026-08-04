# Task 49: Test suggestion automatic Yes response

## Scenario contract

Add one focused Playwright scenario at `e2e/suggestion-auto-yes.spec.ts`.

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option and an option limit of 3. Keep the real public ID, initial revision, and existing option ID from a schema-validated snapshot.
2. Use the anonymous `page` fixture to open the public URL and join through the visible form with a unique guest name. Begin the exact participant POST wait before the click, require HTTP 201, parse `joinParticipantSuccessSchema`, and keep the guest participant ID.
3. Wait for the joined participant's visible response and suggestion controls. Fill the labeled DATE suggestion field with a second distinct future day. Begin the exact options POST wait before clicking `Suggest option`.
4. Require HTTP 201 and parse `addOptionSuccessSchema`. Require a new option ID and a revision larger than the join revision. Wait for the exact `Suggestion added.` status, which is emitted only after the client refresh completes.
5. Through visible controls, prove the new date option exists and its Yes radio is checked for the guest without a separate response action. Prove the new option appears in the shared ledger and the guest row shows `Yes` for it.
6. Read a schema-validated snapshot from the joined page. Require the route revision, exactly one new option with the returned ID and canonical date, `creatorParticipantId` equal to the guest, exactly one response `{ participantId: guest, value: "YES" }`, `yesCount: 1`, `noCount: 0`, and `canDelete: true`.
7. Prove the participant row remains unique and no extra response request occurred for the new option. Observe requests from before suggestion submit and require only the options POST created the automatic Yes response.

## Quality boundary

Use shared E2E fixtures, the creation helper, route schemas, and accessible browser locators. Start network waits and request observation before their triggers. Use no sleeps, fixed public IDs, direct creation APIs, database access, production edits, unrelated live-context assertions, or commits. Do not weaken assertions to avoid a real failure.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in `.superpowers/sdd/appointly-mvp-plan/task-49-report.md`.