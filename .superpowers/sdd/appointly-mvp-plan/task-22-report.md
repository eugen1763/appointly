# Task 22 report

## Status

Complete. `/appointments/new` now renders the authenticated client-side Details, Options, and Share wizard. This task adds no appointment POST route or server transaction.

## RED evidence

The first focused run used the three new test files before production files existed:

```text
npm test -- src/features/appointments/create-appointment-client.test.ts src/features/appointments/creation-owner-default.test.ts src/features/appointments/AppointmentCreationWizard.test.tsx
```

Vitest failed all three suites at import time because `create-appointment-client`, `creation-owner-default`, and `AppointmentCreationWizard` did not exist. This was the expected RED state. The intended focused set contains 27 tests: 19 wizard component cases, 5 production submission-boundary cases, and 3 owner-default cases.

The first GREEN attempt also exposed that the installed `@testing-library/react` package could not load its absent `@testing-library/dom` peer. No dependency was added. The component suite was moved to the repository's raw React DOM and `act` pattern through a small test-only helper.

## GREEN evidence

The final focused run used Node.js 24.13.0 and a fixed `America/New_York` zone so local timed conversion has a literal UTC expectation:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node ./node_modules/vitest/vitest.mjs run src/features/appointments/create-appointment-client.test.ts src/features/appointments/creation-owner-default.test.ts src/features/appointments/AppointmentCreationWizard.test.tsx
```

Result:

```text
Test Files  3 passed (3)
Tests       27 passed (27)
EXIT=0
```

The full TypeScript check also used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node ./node_modules/typescript/bin/tsc --noEmit
```

Result: `EXIT=0` with no diagnostics.

## Browser check

A real Chromium session opened the authenticated wizard at desktop and 320 CSS-pixel widths. At both widths `document.documentElement.scrollWidth` matched the viewport, so the page had no horizontal overflow. A second 320-pixel pass used the shortest valid title (`A`), a short valid co-organizer email (`a@b.co`), and one candidate. Every visible Details and Options link, button, input, select, and textarea measured at least 44 CSS pixels in both width and height; the narrowest short-label action was the 98×44 co-organizer Remove button. The normalized signed-in name appeared as `Ada Lovelace`. Keyboard focus on `Back to details` showed the configured 3-pixel blue outline with a 3-pixel offset. No Playwright command or project-wide suite was run.

## Delivered behavior

- Labeled Details controls with title, description, owner, type, limit, and co-organizer bounds.
- Case-insensitive normalized co-organizer uniqueness and a 20-address cap.
- Ordered, removable candidates with only the selected kind's controls rendered.
- Candidate-count enforcement and type locking until all candidates are removed.
- Browser-local timed values converted to canonical UTC strings at submit time.
- Exact `CreateAppointmentInput` construction with the browser IANA zone.
- Relative-origin production POST boundary with strict 201 success and stable error-body parsing.
- Duplicate-submit suppression, mapped API field errors, retryable general errors, and preserved form state.
- Share rendered only from the returned 201 body, with open-link and named copy success/failure states.
- Responsive ruled-ledger styling, semantic headings and fieldsets, error associations, 44-pixel targets, visible focus, and existing reduced-motion support.

## Concerns and deferred work

- Task 23 still owns `POST /api/appointments` and the transaction, so the production Share step cannot be reached until that route exists. Component tests inject the documented submit boundary; there is no fake fallback.
- Tasks 24 and 25 still own full server date, time, future, and IANA-zone checks. This client performs only the task's required local-to-UTC conversion and required-field checks.

## Review fix round 1

Six component regressions were added before the review fixes. The first Node.js 24.13.0 component run executed 25 tests and failed all six new cases. The failures reproduced the dropped pending co-organizer, mutable Options state during an in-flight submit, daylight-saving gap normalization, and missing type/co-organizer API error output and associations.

The fixes now:

- validate, normalize, deduplicate, and add a nonempty pending co-organizer when Details submits;
- keep invalid or duplicate pending emails on Details with their exact field error;
- disable candidate inputs, Add, Remove, and Back while creation is pending, with mutation handlers also guarded by the submit lock;
- parse local date-time parts, construct the local `Date`, and reject it unless every local getter round-trips to the entered wall time;
- render and associate API errors for appointment type and the co-organizer fieldset.

The final focused command under Node.js 24.13.0 ran all original and review tests:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node ./node_modules/vitest/vitest.mjs run src/features/appointments/create-appointment-client.test.ts src/features/appointments/creation-owner-default.test.ts src/features/appointments/AppointmentCreationWizard.test.tsx
```

Result: 3 files passed, 33 tests passed, 0 failed. The full Node.js 24.13.0 `tsc --noEmit` check exited 0 with no diagnostics.
