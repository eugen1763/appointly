# Task 53: Test stale deletion confirmation refresh

## Files

Add `e2e/stale-option-deletion.spec.ts` and `.superpowers/sdd/appointly-mvp-plan/task-53-report.md`.

## Scenario contract

1. Use `ownerPage` and the real creation wizard to create one active DATE appointment with one future option. Capture the owner participant ID, initial option ID, and revision from a schema-validated snapshot. Require the creation-time owner YES response.
2. Use the anonymous `page` fixture as the second context. Join through the visible form with a generated guest name, parse the exact participant POST response, and bind the guest participant ID. Select Yes for the initial option through its visible response group. Begin the exact PUT wait before checking the radio, parse `putResponseSuccessSchema`, and wait for `Saved`.
3. Refresh the authenticated owner page to the generated public URL. A schema-validated snapshot must bind the owner, option, owner and guest YES identities, `yesCount: 2`, and the current vote revision. Require the owner's exact `data-delete-option` control.
4. Begin the exact option DELETE wait before clicking that owner control. Require HTTP 409 and parse the shared delete-route error schema. Require `DELETE_CONFIRMATION_REQUIRED`, count 2, both exact current names, and a valid token. The open accessible dialog must name the exact option and show exactly two participant rows containing the owner and guest names.
5. While that dialog stays open, change the guest vote in the second context from Yes to No through the visible control. Begin the exact PUT wait before checking it, require HTTP 200, parse `putResponseSuccessSchema`, require the returned NO value and a higher revision, and wait for `Saved`.
6. In the still-open owner dialog, begin the exact DELETE wait before clicking its confirm button. Require HTTP 409 and a schema-valid `STALE_DELETE_CONFIRMATION` body. Require the exact stale message, a replacement token different from the first, count 1, and only the owner name. The option must remain. The same open dialog must announce the stale response message, refresh to one current participant row with only the owner, and remove the guest name.
7. Read schema-validated owner and guest snapshots before final deletion. They must match the guest NO revision, retain the exact option and both responses (owner YES, guest NO), expose `yesCount: 1` and `noCount: 1`, and leave the owner delete control available.
8. Begin a third exact DELETE wait before clicking the same dialog confirm button again. Require HTTP 200, parse `revisionSuccessSchema`, and require a revision beyond the guest vote. The dialog must close, the exact option and its response group and delete control must disappear, and a final schema-validated owner snapshot must contain no options at the returned deletion revision while both participant identities remain.

## Quality boundary

Use shared fixtures, creation helpers, route schemas, accessible locators, exact pre-trigger waits, and generated identities. Keep the owner and guest pages loaded concurrently. Use no sleeps, fixed public IDs, direct appointment or response APIs, direct database access, production edits, unrelated deletion checks, browser commands, or commits.

Skip formatter, linter, TypeScript, build, browser commands, all tests, and commits. Record implementation and pending coordinator validation in the report.