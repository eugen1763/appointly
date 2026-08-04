# Task 44 report: Browser coverage for all option types

## Final status

Implementation and coordinator validation are complete.

## Files

- `e2e/appointment-helpers.ts` provides the typed wizard creation helper and schema-validated snapshot reader.
- `e2e/option-types.spec.ts` provides one focused `ownerPage` scenario for each of `DATE`, `DATE_TIME`, `DATE_RANGE`, and `DATE_TIME_RANGE`.
- `.superpowers/sdd/appointly-mvp-plan/task-44-report.md` records the implementation contract and pending validation.

## Contracts implemented

- The creation input is a discriminated union whose non-empty candidate tuple must match the selected appointment type. Optional owner display name and co-organizer emails are supported.
- Creation navigates to `/appointments/new`, operates the real wizard through accessible labels and role locators, adds every candidate, and submits with `Create appointment`.
- The helper waits for the read-only `Public appointment link` input and requires the exact `http://127.0.0.1:3000/a/{24-character-base64url}` form before returning its URL and public ID.
- Snapshot reads use `page.request` against the real `/api/appointments/{publicId}/snapshot` endpoint, require HTTP 200, and parse the response with `appointmentSnapshotSchema`.
- Each scenario asserts the appointment title, type, option limit, exactly one option, the matching option kind, and the exact ID, creator, and type-specific calendar or instant storage fields required by Task 44. Response state, counts, and deletion permissions remain outside this option-type contract.
- Public assertions open the returned URL, check the exact H1 and type label, and scope display checks to the visible desktop column header selected by both `data-view="desktop"` and the returned snapshot option ID.
- Date-only expectations remain literal calendar text. Timed storage values, browser-formatted labels, and resolved time-zone markers are computed independently with `Date` and `Intl.DateTimeFormat` inside the live Playwright browser context.
- No sleeps, direct creation API calls, database access, fixed public IDs, production edits, Task 43 edits, or unrelated later scenarios were added.

## Coordinator validation

- The coordinator's initial focused E2E run reached all four scenarios, which failed because the assertions expected empty response state while production correctly creates an automatic owner `YES` response for every initial option.
- The fix round changed all four storage checks to `toMatchObject` over only the required ID, creator, kind, and date/time fields. Production behavior was not changed.
- Focused Playwright revalidation: 4 tests passed in Chromium.
- `tsc --noEmit`: exited zero after the fix.
- Task review: no Critical or Important finding.
