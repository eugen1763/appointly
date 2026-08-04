# Task 47 Report

## Files

- Added `e2e/guest-return-response.spec.ts`.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-47-report.md`.
- Updated `src/app/a/[publicId]/AppointmentClient.tsx` so a guest who joins in the current view retains the one-time private-link UI while the refreshed guest snapshot enables response controls.
- Updated `src/app/a/[publicId]/AppointmentClient.tsx` so a pending `null` remains the explicit Unanswered value instead of falling back to the saved response.
- Updated `src/app/a/[publicId]/AppointmentClient.tsx` to clear the current-view join state when a finalized snapshot renders, preventing a later reopen from mounting a fresh join form.
- Updated `src/app/a/[publicId]/AppointmentClient.test.tsx` with the focused join/finalize/reopen regression.

## Implementation

The focused Playwright scenario creates the three ordered DATE options through the owner wizard, confirms their schema-validated snapshot values, and joins through the anonymous appointment UI as `Task 47 Returning Guest`.

It validates the private edit-link structure without exposing its token, grants clipboard permissions only for the configured E2E origin, clicks the visible copy control, waits for the exact copied status, and compares the clipboard value with the complete private href in memory.

After the join succeeds, the E2E waits for the exact `April 3, 2030` response group to become visible and then reasserts the accessible private-link region before reading or copying its href. This proves the participant-selection snapshot refresh completed without unmounting the one-time link UI.

Each response change uses the radio group named by its exact date label. The test begins an exact PUT-route response wait before each visible selection, requires status 200, parses the response with `putResponseSuccessSchema`, verifies the returned value and increasing revision, and waits for both the selected radio and `Saved` state. The initial snapshot proves `YES`, `NO`, and an absent response after an actual Yes-to-Unanswered clear.

A fresh anonymous browser context opens the captured fragment link. The test waits for the exact guest-access exchange response, validates it with `guestAccessSuccessSchema`, requires the fragment-free public redirect, and confirms the saved participant region. Schema-validated snapshots prove the participant ID, display name, and participant set are unchanged. The returned guest then saves final values `NO`, absent, and `YES` through the same visible controls, with no duplicate participant row.

## Reproduction and root cause

The coordinator's focused Playwright reproduction consistently reached the join success response but failed because the visible `Copy private link` button disappeared. `JoinParticipantForm` entered its one-time guest success state and called `onJoined`; `AppointmentClient` then refreshed participant selection, received a guest viewer with accessible participant access, changed `showJoinForm` to false, and unmounted the form containing that success state before it could be copied.

`AppointmentClient` now records that the participant joined in the current mounted view before refreshing participant selection. That local flag keeps the join form mounted for the one-time private-link state. It starts false on every mount, so a returning guest who reloads or opens the private edit link retains the existing behavior and does not see a join form.

The coordinator's post-production-fix reproduction reached the visible copy action and exposed a test-locator ambiguity: the page also renders an option-limit element with the `status` role. The clipboard proof now scopes the status locator to the accessible region named exactly `Save your private edit link` before asserting the exact `Private link copied.` text.

The next coordinator reproduction reached the actual Yes-to-Unanswered clear and proved the pre-clear `YES` snapshot, but the second same-option radio appeared to revert. The initial lock-order hypothesis was disproved: the failure state showed the fieldset disabled with `Saving`, proving the change handler entered `save`; the early lock releases were reverted so only the original `finally` cleanup remains. The confirmed root cause was nullable pending-state handling: both the save equality check and rendered selected value used `pendingResponse?.value ?? savedResponse(...)`, treating the valid pending `null` value as absent and falling back to saved `YES`. Both paths now test whether the pending entry itself is `undefined`, preserving `null` as the explicit Unanswered value. The snapshot-before-clear assertion and uninterrupted visible-control sequence remain unchanged.

Task review found that the E2E needed an explicit synchronization proof between join and copy, and that `joinedInThisView` can outlive the one-time form state across appointment lifecycle changes. The new red regression `does not resurrect the join form after a joined guest sees finalize and reopen updates` renders an anonymous active snapshot, submits the real guest join form, resolves the participant snapshot, proves private-link success and response controls coexist, then applies finalized and reopened snapshots through `FakeEventSource`. Its final accessible assertion requires that no fresh `Join appointment` form appears after reopen. The current persistent local flag makes that assertion fail as intended; production was not changed in this review round.

The coordinator ran the focused lifecycle regression against the persistent-flag implementation and observed the required red result: 1 failed, 53 skipped. The minimal production fix uses the existing React effect lifecycle to clear `joinedInThisView` whenever the rendered appointment status becomes `FINALIZED`; a subsequent active SSE snapshot therefore cannot remount a fresh join form. No unrelated state changes.

## Coordinator validation

- Focused Playwright validation after all review fixes: 1 test passed in Chromium.
- Focused lifecycle regression before the lifecycle reset: 1 failed and 53 skipped, confirming the intended red state.
- Focused lifecycle regression after the lifecycle reset: 1 passed and 53 skipped.
- Full `AppointmentClient.test.tsx`: 54 tests passed.
- `tsc --noEmit`: exited zero.
- Task re-review: clean, with no Critical or Important finding.
