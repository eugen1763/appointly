# Task 24 Report

## Status

Complete. Appointment creation now accepts only exact, calendar-valid date-only values and exact canonical UTC timed values. It validates every initial option before opening the immediate SQLite transaction, maps submitted defects to the exact option field, stores canonical date text or integer milliseconds, and keeps the existing appointment graph, duplicate, type, response, and publication rules.

## RED evidence

The first focused run used Node.js 24.13.0 with the fixed Task 22 browser test zone:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/server/option-storage.test.ts \
  src/features/appointments/server/create-appointment.test.ts \
  src/features/appointments/AppointmentCreationWizard.test.tsx
```

Result: exit 1; 2 files failed and 1 passed; 36 tests failed and 69 passed out of 105.

The seven creation failures showed that malformed or impossible values could pass, or that range failures used the broad `options.0` path instead of `options.0.endDate` or `options.0.endAt`. The 29 reusable-boundary cases failed because `validateOptionInputForStorage` did not exist. The Task 22 client cases remained green.

## GREEN evidence

The final focused run used Node.js 24.13.0:

```text
TZ=America/New_York /home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/server/option-storage.test.ts \
  src/features/appointments/server/create-appointment.test.ts \
  src/features/appointments/contracts.test.ts \
  src/features/appointments/create-appointment-client.test.ts \
  src/features/appointments/AppointmentCreationWizard.test.tsx
```

Result: exit 0; 5 files passed; 180 tests passed and 0 failed.

The full TypeScript command also used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/typescript/bin/tsc --noEmit
```

Result: exit 0 with no diagnostics.

## Delivered behavior

- Date-only input must match `YYYY-MM-DD` exactly and pass proleptic-Gregorian year, month, day, and leap-year checks. The validator never parses date-only text with `Date` or the server time zone.
- Timed input must match `YYYY-MM-DDTHH:mm:ss.sssZ` exactly, parse to finite safe-integer milliseconds, and round-trip through `toISOString()` without change.
- Offsets, missing or short milliseconds, expanded years, impossible dates, normalized `24:00`, lowercase suffixes, whitespace, and trailing data fail.
- Date ranges compare validated date text lexically and allow equal endpoints. A reversed range reports `endDate`.
- Timed ranges require a valid canonical value at each endpoint and `endAt > startAt`. A non-increasing range reports `endAt`.
- The reusable storage boundary returns relative field errors. Appointment creation adds `options.<index>.` so each `VALIDATION_FAILED` response points at the exact submitted field and maps to HTTP 400.
- Appointment creation validates and converts every initial option before `clock.now()`, public-ID allocation, `runImmediate`, any graph write, or event publication.
- Existing kind matching, canonical duplicate detection, canonical keys, owner creators, initial owner `YES` responses, rollback, and post-commit publication behavior remain intact.
- Client tests now cover exact canonical UTC submission for both `DATE_TIME` and `DATE_TIME_RANGE`; daylight-saving-gap normalization and local values that serialize to expanded UTC years are blocked before the submit request.

## Review and concerns

The focused review found one client-boundary edge: a valid local value near the end of year 9999 can convert to an expanded UTC year that the strict server rejects. A new RED client test failed with 1 failed and 26 passed because the request was sent. The converter now checks its `toISOString()` output against the same exact canonical shape and shows the candidate field error without calling `submit`; the focused client file then passed all 27 tests.

Task 25 still owns IANA-zone validation and current/future-date rules; this task does not add either rule. No open concern remains.
