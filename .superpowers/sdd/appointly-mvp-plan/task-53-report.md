# Task 53 Report

## Files

- Added `e2e/stale-option-deletion.spec.ts` with one typed stale-confirmation deletion scenario.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-53-report.md`.
- No production or existing test file was changed.

## Eight-step scenario

1. The authenticated `ownerPage` drives `createAppointmentThroughWizard` to create one active DATE appointment with one future option and a named owner. An exact pre-trigger creation-route wait requires HTTP 201 and parses `createAppointmentSuccessSchema`. A schema-validated snapshot binds the generated public ID, owner participant ID, option ID, and initial revision, and proves the creation-time owner `YES` response, counts, creator identity, and deletion permission.
2. The anonymous `page` fixture remains loaded as the second browser context and joins through the visible labeled form with a guest name generated from the public ID. The exact participant POST wait starts before the join click; its request and HTTP 201 response parse through the shared schemas and bind the guest participant ID and join revision. The guest selects `Yes` through the option's visible radio group only after the exact PUT wait is installed. The typed success body returns `YES` at a higher revision, and the option-scoped UI reaches `Saved`.
3. The owner loads the generated public URL while the guest page remains loaded. A schema-validated owner snapshot binds both participant identities, the exact option and two `YES` responses, `yesCount: 2`, and the vote revision. The exact captured option ID is present on the owner's `data-delete-option` button.
4. The first exact DELETE wait begins before the owner clicks the visible delete control. Its request parses as the owner without a token. HTTP 409 parses through the shared delete-route error schema and requires the exact `DELETE_CONFIRMATION_REQUIRED` message, a valid token, count two, and exactly the current owner and guest names. The accessible dialog names the exact date option and has exactly two participant rows in the response's order, containing those two exact names.
5. The dialog remains open while the guest changes the same visible response group from `Yes` to `No`. The exact PUT wait starts before the radio check. The request binds the guest and `NO`; the HTTP 200 body parses through `putResponseSuccessSchema` and returns `NO` at a revision higher than the `YES` revision. The test then waits for the exact guest/option ledger cell to render `No` before requiring the option-scoped UI to say `Saved`, so both post-response observables belong to the completed `NO` update.
6. The second exact DELETE wait begins before the same dialog's confirmation button is clicked. The parsed request proves that it submits the original token. HTTP 409 parses through the shared delete-route error schema and requires the exact `STALE_DELETE_CONFIRMATION` message, a distinct schema-valid replacement token, count one, and only the owner name. The test first waits for exactly one stale-only status, then requires exactly one `dialog[data-delete-dialog]` DOM node and exactly one matching accessible stale dialog. It next proves the originally captured dialog element remains connected and open before reading the refreshed one-row owner-only participant list through the stale-filtered accessible dialog, removing the guest name, and requiring the option and owner delete control to remain present.
7. Schema-validated owner and guest snapshots are read concurrently before final confirmation. Both equal the guest `NO` revision, retain the exact option, participants, owner `YES`, and guest `NO`, and expose `yesCount: 1` and `noCount: 1`. The snapshots bind their respective viewer identities, preserve owner-only deletion permission, and the owner control remains available.
8. The third exact DELETE wait begins before the same dialog confirmation button is clicked again. The parsed request proves use of the replacement token. HTTP 200 parses through `revisionSuccessSchema` and returns a revision beyond the guest vote. The dialog closes, and the exact response group and captured delete control disappear. A final schema-validated owner snapshot equals the returned deletion revision, retains both exact participant identities, and contains no options or option responses.

## Boundaries

The scenario uses the existing fixtures and appointment helpers, visible join and response controls, accessible locators, shared request/response/route schemas, generated public and participant identities, and exact pre-trigger route waits. Both owner and guest pages stay loaded concurrently. It uses no sleep, fixed public ID, direct mutation API, database access, production edit, existing-test edit, browser command, test command, formatter, linter, TypeScript command, build, or commit.

## Coordinator validation

- Initial focused Playwright validation: 1 test passed in Chromium.
- Initial `tsc --noEmit`: exited zero.
- Task review found two Important synchronization defects: the original check could inspect the captured dialog before React committed the stale state, and the guest save status could already contain `Saved` from the earlier `YES` update.
- The first review fixes waited for the exact stale-only status and sole stale-filtered accessible dialog, then checked that the previously captured dialog node remained connected and open before asserting refreshed rows through that stale-filtered dialog.
- The guest `NO` path waits for the exact guest/option ledger cell to render `No` before asserting the option-scoped `Saved` status.
- Focused Playwright validation after both first-round fixes: 1 test passed in Chromium.
- `tsc --noEmit` after both first-round fixes: exited zero.
- Re-review found one remaining Important gap: an accessible-dialog count alone did not rule out a detached captured node being replaced or an old-plus-new pair.
- The stale path now requires exactly one `dialog[data-delete-dialog]` DOM node after the stale status appears and before evaluating the captured node; content assertions remain scoped to the stale-filtered accessible dialog.
- Focused Playwright validation after the dialog identity fix: 1 test passed in Chromium.
- `tsc --noEmit` after the dialog identity fix: exited zero.
- Task re-review round 2: clean, with no Critical or Important finding.
