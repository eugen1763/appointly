# Task 49 Report

## Files

- Added `e2e/suggestion-auto-yes.spec.ts`.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-49-report.md`.
- No production files or existing tests were changed.

## Scenario assertions

The focused Playwright scenario uses the authenticated `ownerPage` fixture and `createAppointmentThroughWizard` to create one active DATE appointment with a generated public ID, one future date option, and an option limit of three. A schema-validated owner snapshot proves the appointment contract, initial revision, canonical initial date, and single existing option ID before the public flow begins.

The anonymous `page` fixture opens the generated public URL and joins through the visible `Join appointment` form with a guest name derived from that appointment's generated public ID. The exact participant POST response wait starts before the click. The scenario requires HTTP 201, parses the response with `joinParticipantSuccessSchema`, confirms the anonymous join returned a private edit link, retains the guest participant ID and join revision, and waits for both the joined participant's response controls and suggestion form to become visible.

The visible DATE field inside the labeled `Suggest an option` form receives a second, distinct future calendar day. Request observation and the exact options POST response wait both begin before the visible `Suggest option` click. The scenario requires HTTP 201, parses `addOptionSuccessSchema`, proves the returned option ID differs from the original ID, and proves the returned revision advances beyond the join revision. It then waits for the exact `Suggestion added.` status, which is emitted only after the client snapshot refresh finishes.

After that refresh, the scenario proves through visible controls that the returned option's date group exists and its guest Yes radio is already checked. In the visible shared response ledger, the returned option ID has the canonical date label, exactly one row has the unique guest name, and that option/participant cell reads `Yes`. The visible deletion region exposes exactly one `Delete option` control and its `data-delete-option` identity is the returned option ID, independently proving suggestion ownership in the rendered UI.

A final schema-validated snapshot from the joined page requires the route revision to equal the add-option revision and the option collection to contain the original option plus exactly one new option. The new option must equal the complete DATE snapshot object with the returned ID, canonical suggested date, guest creator ID, exactly one response `{ participantId: guest, value: "YES" }`, `yesCount: 1`, `noCount: 0`, and `canDelete: true`. Participant checks require exactly one row by guest ID and exactly one row by guest display name, both resolving to the same participant, while the visible desktop ledger must still contain exactly one matching row header.

The request observer covers the suggestion submit through the post-refresh UI and schema-validated snapshot proofs. Among the appointment's automatic-Yes mutation routes, it requires exactly one request: the exact options POST. It separately requires zero PUT requests to the returned option's response route, proving that no response action supplied the automatic Yes.

## Determinism and boundaries

The scenario has no sleeps, fixed public ID, direct appointment-creation API, database access, response-control interaction, or unrelated live-context assertion. All triggering actions use visible accessible controls, all mutation waits are installed before their triggers, and all route and snapshot payloads are parsed with shared contracts.

## Coordinator validation

- Coordinator TypeScript validation passed.
- The focused Playwright 1.62 run reached the refreshed ledger and reproduced one locator-only failure: the row filter supplied a `has` rowheader locator rooted at `ledger`, so Playwright evaluated a nested table path within every candidate row and matched none.
- The locator now keeps the candidate rows scoped to the visible ledger while resolving the exact accessible guest rowheader from `page`, Playwright's standard relative-filter pattern. The exact row-count and returned-option cell assertions remain unchanged.
- Focused Playwright validation after the locator correction: 1 test passed in Chromium.
- Task review: clean, with no Critical or Important finding.
