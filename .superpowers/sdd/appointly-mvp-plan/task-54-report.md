# Task 54 Report

## Files

- Added `e2e/finalized-reopen.spec.ts` with one typed deterministic finalized/reopen lifecycle scenario.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-54-report.md`.
- No production file or existing test was changed.

## Eight-step scenario

1. The authenticated `ownerPage` drives the real creation wizard to create one active DATE appointment with option limit three and one future option. A schema-validated snapshot proves revision 1, binds the generated public ID, owner participant ID, and initial option ID, and records the creation-time owner Yes response and option ownership.
2. The already-loaded anonymous `page` joins through the visible labeled form. An exact participant POST wait starts before the click, and the shared request and success schemas bind the generated guest ID and exact revision 2. Exact pre-trigger UI waits similarly capture the guest's initial Yes PUT at revision 3 and distinct DATE suggestion POST at revision 4. Shared schemas validate each request and result; the guest snapshot proves both option identities, guest ownership of the suggestion, and its automatic Yes without an extra response write.
3. The owner loads the generated public URL. The active owner snapshot proves both participant identities and the exact two-option response graph. The owner selects the captured initial option in the visible finalize form; an exact finalize POST wait starts before submission, the request parses through `finalizeRequestSchema`, and the HTTP 200 `revisionSuccessSchema` result binds exact revision 5.
4. The already-loaded owner and guest pages both visibly reach Finalized, announce the exact finalized notice, and mark only the captured initial option as Selected. All radios, suggestion forms, option-delete controls, join forms, and finalize forms are absent. Only the owner exposes Reopen. A fresh anonymous context loads the same generated URL, proves the same read-only boundary, and is closed in `finally`.
5. Only the four permitted direct finalized writes are sent. The fresh anonymous context sends the schema-valid participant POST. The existing guest context sends the schema-valid response PUT, third distinct DATE option POST, and guest-owned suggestion DELETE. Each route returns HTTP 409, parses through its route-specific shared error schema, and equals `APPOINTMENT_FINALIZED` with the exact join, response, suggestion, or deletion message.
6. Schema-validated owner and guest snapshots after all four denials remain exactly at revision 5 with status `FINALIZED`, the initial option as `finalOptionId`, both generated participant identities, and the exact unchanged two-option ownership, response, and count graph. Both finalized snapshots expose no deletable option.
7. The owner's visible Reopen button is clicked only after the exact reopen POST wait begins. The bodyless request is validated, HTTP 200 parses through `revisionSuccessSchema`, and the result is exact revision 6. Both already-loaded contexts visibly return to Active, lose the finalized notice and all selected markers, and restore the owner finalize form. The guest regains all three response radios, the suggestion form, and exactly the guest-owned option's delete control.
8. The guest changes the initial response from Yes to No through the restored radio after installing the exact PUT wait. The shared request and success schemas prove the same guest identity, `NO`, and exact revision 7. The test waits for the exact guest/option ledger cell to render No before accepting the option-scoped Saved status. Final owner and guest snapshots are both active at revision 7 with `finalOptionId: null`, preserve both option identities and the suggestion's automatic guest Yes, and record guest No on the reopened initial option with actor-correct deletion permissions.

## Boundaries

The implementation uses Playwright fixtures, the creation and snapshot helpers, accessible locators, generated identities, exact pre-trigger route waits, shared request/success/error schemas, and same-origin direct fetch only for the four finalized denials whose controls are intentionally absent. It introduces no sleep, fixed public ID, direct creation API, database access, production edit, existing-test edit, unrelated management write, browser command, test command, formatter, linter, TypeScript command, build, or commit.

## Coordinator validation

- Focused Playwright validation: 1 test passed in Chromium.
- `tsc --noEmit`: exited zero.
- Task review: clean, with no Critical or Important finding.
