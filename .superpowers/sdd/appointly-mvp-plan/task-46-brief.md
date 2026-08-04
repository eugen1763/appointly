# Task 46: Test co-organizer dashboard and permissions

Add Playwright coverage that invites the second authenticated fixture user, proves their dashboard access, and verifies the co-organizer permission boundary end to end.

## Required files

- Add `e2e/co-organizer-permissions.spec.ts`.
- Reuse `e2e/appointment-helpers.ts`, `e2e/auth-identities.ts`, and `e2e/fixtures.ts` without modifying them.
- Add `.superpowers/sdd/appointly-mvp-plan/task-46-report.md`.
- Do not change production files, Playwright config, fixture setup, package scripts, or earlier E2E specs.

## Scenario contract

Use one focused test with both independent authenticated fixtures: `ownerPage` and `coOrganizerPage`.

1. Through `createAppointmentThroughWizard`, let the owner create a `DATE` appointment with title `Task 46 co-organizer permissions`, option limit 1, candidate `2030-04-03`, and `CO_ORGANIZER_IDENTITY.email` in `coOrganizerEmails`.
2. Read the owner snapshot. Require one `DATE` option and retain its real option ID.
3. Navigate the co-organizer page to `/dashboard`. This must bind the pending email invitation through the real dashboard path.
4. Assert the `Appointments` list contains one card for the exact title. Assert that card shows `Co-organizer`, `Active`, and `Day`. Click its exact title link and assert navigation to the returned public URL.
5. Read the snapshot through the co-organizer page. Assert an authenticated viewer with permissions `canEditAppointment: true`, `canFinalize: true`, `canReopen: false`, `canDeleteAppointment: false`, and `canManageCoOrganizers: false`. `canReopen` is state-sensitive and false while the appointment is active.
6. From the live co-organizer page, use same-origin browser `fetch` to `PATCH /api/appointments/{publicId}` with `{ "title": "Task 46 co-organizer updated" }`. Require HTTP 200 and a numeric revision. Reload the public page and assert the H1 has the updated title. This proves real browser-session edit access without inventing a missing detail-editor UI.
7. Assert no visible `Delete appointment` heading or button exists for the co-organizer.
8. From that same page, call `GET /api/appointments/{publicId}/managers` and `POST /api/appointments/{publicId}/managers` with a new email. Require both to return HTTP 403 with stable `FORBIDDEN` errors. This proves the user cannot list or add co-organizers. Do not use an owner page for these calls.
9. From that same page, call `DELETE /api/appointments/{publicId}` with the exact updated title. Require HTTP 403 with stable `FORBIDDEN`. Read the snapshot again and prove the appointment still exists.
10. In the visible `Finalize appointment` form, choose the radio whose accessible name is `April 3, 2030`, then click `Finalize appointment`.
11. Wait for the finalized status notice. Read the co-organizer snapshot and assert `status: "FINALIZED"`, `finalOptionId` equals the real option ID, the revision increased beyond the post-edit revision, and `canReopen: true`.

## Browser request helper

A local helper inside the spec may call `page.evaluate` and same-origin `fetch` with JSON headers and bodies. Return `{ status, body }` as serializable data. Parse success and error bodies through the existing public Zod schemas where practical, or assert the exact stable shape. Do not use `page.request` for mutation permission checks because browser `fetch` proves the actual same-origin session and Origin behavior.

## Quality boundary

- Invitation and creation must use the real wizard UI. Dashboard binding must occur through `/dashboard`.
- The two authenticated fixtures must remain independent contexts.
- Scope the dashboard assertion to the matching appointment list item. Do not pass from unrelated page text.
- Use exact role/label locators and condition-based assertions. Do not use sleeps.
- Do not expect a detail-editor or co-organizer manager UI that the product does not implement. Use same-origin route calls for those permission contracts.
- Run all forbidden calls while the appointment is active so finalization cannot mask permission errors.
- Do not add guest, reset, SSE, boundary, deletion-fingerprint, reopen, or responsive scenarios.
- Record files, exact permissions, route results, finalization result, and coordinator validation in the report.
- Skip formatter, linter, TypeScript, builds, browser commands, all tests, and commits. The coordinator validates and commits.
