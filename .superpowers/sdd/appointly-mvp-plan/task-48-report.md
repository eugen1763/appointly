# Task 48 Report

## Files

- Added `e2e/guest-link-reset.spec.ts`.
- Added this report at `.superpowers/sdd/appointly-mvp-plan/task-48-report.md`.
- Updated `src/app/a/[publicId]/AppointmentClient.tsx` so a reset guest link clears the stale current-view join success state when the live snapshot revokes guest access.

## Scenario assertions

The focused Playwright scenario creates one active DATE appointment with one future option through the authenticated owner's visible creation wizard. It reads the schema-validated owner snapshot to retain the generated public appointment ID and option ID, then joins from the anonymous public page through the visible join form.

The scenario begins exact route-response waits before the join and visible Yes selection. It validates the join and response success bodies with the shared Zod schemas, keeps the private href in a local variable, records the participant identity and revision, and synchronizes with the exact participant-selection snapshot refresh after the saved response.

Before the owner triggers the same-origin, bodyless reset request, the old guest page begins waiting for the exact participant-selection snapshot refresh emitted through the live SSE flow. The reset response must be HTTP 200 and satisfy `resetParticipantLinkSuccessSchema`; it must retain the participant identity, return a different private href, and advance the saved revision. The live snapshot must satisfy `appointmentSnapshotSchema` and show that the old browser is anonymous, has no active or accessible participant, and cannot respond. The scenario also requires the visible response region to disappear and the Join form to return.

A direct response attempt from the revoked old browser must return HTTP 403. Its body is validated through the shared route error contract and must exactly contain `FORBIDDEN` with the stable participant-access message.

A fresh anonymous context opens the old private href only after the exact guest-access response wait is active. The exchange must return HTTP 403 with the schema-validated, stable `INVALID_EDIT_LINK` body. The edit page must consume its fragment, remain on the fragment-free edit URL, and render the visible `Link unavailable` state.

A second fresh anonymous context opens the replacement href with the same pre-trigger wait. The exchange must return HTTP 200 and satisfy `guestAccessSuccessSchema` with the original participant identity. The page must reach the fragment-free public appointment URL, show the saved participant region, and retain the checked Yes response. A final schema-validated snapshot proves the participant row and display name remain unique and unchanged, the original option remains, and exactly one `YES` response belongs to the same participant.

## Teardown

Every browser context created by the scenario is registered immediately and closed from one outer `finally` block. This covers both old-link and replacement-link contexts when a later assertion or context creation fails. Fixture-owned contexts remain under the shared fixture teardown.

## Reproduction and root cause

The coordinator's focused Playwright run reached the reset, validated its success body, and parsed the ensuing live snapshot as an anonymous viewer with no active or accessible participant. The red result occurred when the expected Join form did not return.

Task 47's `joinedInThisView` state deliberately retained the one-time private-link success component through the normal post-join guest snapshot refresh. That state also remained true after the reset snapshot changed the viewer from an accessible guest to an anonymous viewer with no accessible participants, so `showJoinForm` kept the stale success component mounted instead of revealing a fresh Join form.

The first production fix cleared `joinedInThisView` directly when the anonymous snapshot arrived, but it did not remount the form. `showJoinForm` was true before the effect because of `joinedInThisView` and remained true afterward because the anonymous viewer had no accessible participant, so React preserved the same `JoinParticipantForm` instance and its stale success state.

The corrected transition derives `currentViewAccessRevoked` from the retained current-view state, the anonymous/no-access snapshot, a completed participant selection, and the absence of a snapshot refresh error. For that one render, `showJoinForm` is false and the stale success component unmounts. The existing lifecycle effect then clears `joinedInThisView`; the normal anonymous condition mounts a fresh Join form on the next render. The pending and error guards preserve the one-time private-link UI during the normal joined guest refresh and a failed participant refresh, while finalized appointments retain their existing clearing behavior.

Task review found that the exact snapshot URL is also used by the EventSource `onopen` repair, so the original waits could accept a pre-mutation GET before the save- or reset-driven refresh. A typed snapshot wait now starts before each mutation, filters for the exact GET URL and HTTP 200, validates each candidate with `appointmentSnapshotSchema`, and continues until mutation-specific state is visible. The save wait requires a revision beyond the join with the participant active; the reset wait requires a revision beyond the saved response plus the complete anonymous, inaccessible, non-responding viewer state.

## Coordinator validation

- TypeScript validation passed before the production fix.
- Focused Playwright validation produced the required red result at the returning Join form after reset; all preceding reset and live revocation assertions passed.
- The first post-fix focused rerun reached the same assertion and proved that clearing state alone did not remount the form.
- Focused Playwright validation after the corrected remount transition: 1 test passed in Chromium.
- Full `AppointmentClient.test.tsx`: 54 tests passed.
- `tsc --noEmit` before the snapshot-wait review fix: exited zero.
- Task review identified and fixed the EventSource `onopen` snapshot race.
- Focused Playwright validation after the predicate-based snapshot waits: 1 test passed in Chromium.
- Final `tsc --noEmit`: exited zero.
- Task re-review: clean, with no Critical, Important, or Minor finding.
