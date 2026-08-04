# Task 46 report: Co-organizer dashboard and permissions

## Final status

Implementation and coordinator validation are complete.

## Files

- `e2e/co-organizer-permissions.spec.ts` adds one focused scenario using the independent authenticated `ownerPage` and `coOrganizerPage` fixtures.
- `.superpowers/sdd/appointly-mvp-plan/task-46-report.md` records the implemented contract and completed coordinator validation.

## Contracts implemented

- The owner creates `Task 46 co-organizer permissions` through the real appointment wizard as a `DATE` appointment with option limit 1, candidate `2030-04-03`, and the fixed co-organizer fixture email. The owner snapshot must contain exactly one matching `DATE` option, whose real ID is retained.
- The co-organizer opens `/dashboard`, binding the pending invitation through the production dashboard path. The scenario scopes assertions to the single matching item in the accessible `Appointments` list, requires the exact `Co-organizer`, `Active`, and `Day` labels, clicks the exact title link, and requires navigation to the wizard's returned public URL.
- The bound active viewer must be authenticated with the exact permission snapshot `canEditAppointment: true`, `canManageCoOrganizers: false`, `canDeleteAppointment: false`, `canFinalize: true`, `canReopen: false`, `canResetGuestLinks: true`, `canRespond: true`, and `canSuggest: true`.
- A serializable `page.evaluate` helper issues same-origin browser `fetch` requests. The co-organizer `PATCH` updates the title to `Task 46 co-organizer updated`, must return HTTP 200 with a schema-validated numeric revision, and the reloaded public page must show the updated exact H1.
- The co-organizer page must contain no exact `Delete appointment` heading or button. While the appointment is still `ACTIVE`, `GET /api/appointments/{publicId}/managers` and `POST /api/appointments/{publicId}/managers` must each return HTTP 403 with exact `FORBIDDEN` body `{ error: { code: "FORBIDDEN", message: "Appointment owner access is required." } }`. `DELETE /api/appointments/{publicId}` with the exact updated title must return HTTP 403 with exact body `{ error: { code: "FORBIDDEN", message: "Only the appointment owner can delete this appointment." } }`. Each body is also parsed through its public route error schema.
- The snapshot after all three forbidden calls must still be `ACTIVE`, retain the updated title, real option, null final option, and the post-edit revision, proving that the appointment still exists and the rejected calls did not mutate it.
- The co-organizer uses the visible accessible `Finalize appointment` form, selects the exact `April 3, 2030` radio, and submits its exact button. The scenario waits conditionally for the finalized role-status notice, then requires an exact finalized appointment record with the updated title, `status: "FINALIZED"`, the retained real option ID as `finalOptionId`, and a revision greater than the post-edit revision. The finalized viewer must have `canReopen: true`, recording the state-sensitive lifecycle permission.
- No sleeps, direct appointment creation API calls, `page.request` mutation checks, production edits, unrelated scenarios, commands, tests, formatters, linters, builds, or commits were added or run.

## Coordinator validation

- Focused Playwright validation: 1 test passed in Chromium.
- `tsc --noEmit`: exited zero.
- Task review: no Critical or Important finding.
