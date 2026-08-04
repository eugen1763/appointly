# Task 54: Test finalized writes and reopen flow

## Files

Add `e2e/finalized-reopen.spec.ts` and `.superpowers/sdd/appointly-mvp-plan/task-54-report.md`.

## Scenario contract

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option and option limit 3. Capture the owner participant and initial option identities from a schema-validated snapshot.
2. Keep the anonymous `page` loaded as a guest context. Join through the visible form, bind the schema-validated participant POST result, save Yes for the initial option through its radio with an exact PUT wait and `putResponseSuccessSchema`, then suggest a distinct second DATE option through visible controls with an exact POST wait and `addOptionSuccessSchema`. Prove the guest owns that suggestion and has automatic Yes.
3. Load the current owner view. Through the visible `Finalize appointment` form, choose the exact initial option, begin the exact finalize POST wait before submitting, require HTTP 200, parse `revisionSuccessSchema`, and bind the finalized revision.
4. Require finalized, read-only UI in both already-loaded contexts. The owner and guest pages must announce `Appointment finalized. The selected option is marked below.` and show status Finalized. The selected option must carry the final selected marker. Response radios, the suggestion form, all `data-delete-option` controls, the join form, and the finalize form must be absent. The owner must expose the visible `Reopen appointment` control. A fresh anonymous context must also show no join form or other public write control and must close in `finally`.
5. While finalized, send each public write directly from the correct same-origin context because its UI control is absent: fresh anonymous participant POST; existing guest response PUT; existing guest option POST for a third distinct DATE; existing guest DELETE for the guest-owned suggested option. Validate each request with its shared request schema. Require HTTP 409, parse the corresponding route error schema, and require exact code `APPOINTMENT_FINALIZED` plus its route-specific message.
6. Read schema-validated owner and guest snapshots after all four denied writes. Both must remain exactly at the finalized revision, status `FINALIZED`, `finalOptionId` equal to the initial option, and retain the exact two-option response graph unchanged.
7. Through the owner's visible Reopen control, begin the exact reopen POST wait before clicking. Require HTTP 200, parse `revisionSuccessSchema`, and require a higher revision. The owner and already-loaded guest pages must return to status Active. The finalized notice and selected markers must disappear. Guest response controls, suggestion controls, and the guest-owned option delete control must return.
8. In the reopened guest page, change the initial option response from Yes to No through the visible radio. Begin the exact PUT wait before checking it, require HTTP 200, parse `putResponseSuccessSchema`, require `NO` and a revision beyond reopen, and wait for the guest ledger cell to render No before accepting `Saved`. Final schema-validated owner and guest snapshots must be active at that save revision, have `finalOptionId: null`, retain both option identities, retain the guest-owned suggestion automatic Yes, and record the reopened initial response as guest No.

## Finalized server messages

- Join: `Reopen the appointment before adding a participant.`
- Response: `Reopen the appointment before changing a response.`
- Suggestion: `Reopen the appointment before adding an option.`
- Deletion: `Reopen the appointment before deleting an option.`

## Quality boundary

Use shared fixtures, creation helpers, route schemas, accessible locators, exact pre-trigger waits, and generated identities. Direct same-origin fetch is allowed only for the four finalized write denials because the corresponding UI controls must be absent. Use no sleeps, fixed public IDs, direct creation API, database access, production edits, unrelated management writes, browser commands, or commits.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in the report.