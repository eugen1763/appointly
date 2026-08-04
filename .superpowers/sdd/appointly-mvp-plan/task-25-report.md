# Task 25 Report

## Status

Complete. Appointment creation now validates the submitted IANA time zone and rejects option starts before the submitter-zone current date or the injected current instant. It keeps Task 24 strict syntax conversion first, performs all new checks before the immediate transaction, and uses one clock value for validation and every stored timestamp.

## RED evidence

The failing focused run used Node.js 24.13.0 with a fixed non-UTC process zone:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/server/create-appointment.test.ts
```

Result: exit 1; 1 file failed; 8 tests failed and 39 passed out of 47.

The eight failures were the four earlier-start cases, the opposite-date-zone rejection, the local-midnight rollover rejection, invalid-zone rejection, and formatter-runtime-fault mapping. Each failed because appointment creation still accepted the input instead of returning the required error.

## GREEN evidence

The final focused run used Node.js 24.13.0:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/server/option-storage.test.ts \
  src/features/appointments/server/create-appointment.test.ts \
  src/features/appointments/contracts.test.ts \
  src/features/appointments/create-appointment-client.test.ts \
  src/features/appointments/AppointmentCreationWizard.test.tsx \
  src/app/api/appointments/route-handler.test.ts \
  src/app/api/appointments/route.test.ts
```

Result: exit 0; 7 files passed; 210 tests passed and 0 failed.

The full TypeScript command also used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/typescript/bin/tsc --noEmit
```

Result: exit 0 with no diagnostics.

## Delivered behavior

- The reusable option-creation boundary constructs exactly `Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })`.
- It builds the current `YYYY-MM-DD` only from `formatToParts(now)`. It does not parse date-only option text as a `Date`.
- Appointment creation performs Task 24 kind, syntax, calendar, canonical UTC, range, and duplicate checks before it reads the clock or validates future rules.
- A valid submitted option then uses one safe-integer `clock.now()` value for the submitter-zone date, timed comparisons, and all `createdAt` and `updatedAt` values.
- `DATE` and `DATE_RANGE` allow submitter-local today. `DATE_TIME` and `DATE_TIME_RANGE` allow a start equal to the injected current instant.
- Earlier date starts return `options.N.startDate`; earlier timed starts return `options.N.startAt`. Invalid zones return `timeZone`. Each maps to HTTP 400 `VALIDATION_FAILED` before writes or publication.
- Tests cover `Pacific/Kiritimati` and `Pacific/Honolulu` on opposite calendar dates at one instant, plus the millisecond before and exact instant of local midnight in `America/New_York`.
- Clock and formatter runtime faults return generic HTTP 500 `INTERNAL_ERROR` data. Submitted time-zone or runtime details do not enter the response.
- Historical values remain valid at the strict storage-conversion boundary for all four option kinds. Future checks run only from option-creation commands; no stored-option expiry or removal rule was added.
- Existing graph atomicity, canonical duplicates, strict request and client handling, route behavior, and post-commit publication tests remain green.

## Concerns

None.
