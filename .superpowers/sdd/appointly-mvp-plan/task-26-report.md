# Task 26 Report

## Status

Complete. Bound appointment managers can now patch only title, description, and option limit through the production Node route. The command validates before writes, uses one immediate transaction and one clock value, increments the revision once only for stored changes, and isolates post-commit event failures.

## RED evidence

The failing focused run used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/contracts.test.ts \
  src/features/appointments/server/management-update.test.ts \
  'src/app/api/appointments/[publicId]/route-handler.test.ts' \
  'src/app/api/appointments/[publicId]/route.test.ts'
```

Result: exit 1; 4 test files failed. The contract test reported the old `manager` actor instead of `bound-manager`; the missing service command caused 14 service failures; and both missing route modules failed to load. Across runnable tests, 15 failed and 68 passed out of 83.

## GREEN evidence

The final focused run used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/vitest/vitest.mjs run \
  src/features/appointments/contracts.test.ts \
  src/features/appointments/validation.test.ts \
  src/features/appointments/server/transactions.test.ts \
  src/features/appointments/server/authorization.test.ts \
  src/features/appointments/server/create-appointment.test.ts \
  src/features/appointments/server/management.test.ts \
  src/features/appointments/server/management-lifecycle.test.ts \
  src/features/appointments/server/management-update.test.ts \
  'src/app/api/appointments/[publicId]/route-handler.test.ts' \
  'src/app/api/appointments/[publicId]/route.test.ts'
```

Result: exit 0; 10 files passed; 233 tests passed and 0 failed.

The full TypeScript command also used Node.js 24.13.0:

```text
/home/finn/.cache/appointly-node24/node_modules/node-linux-x64/bin/node \
  ./node_modules/typescript/bin/tsc --noEmit
```

Result: exit 0 with no diagnostics.

## Delivered behavior

- The strict partial request accepts at least one of `title`, `description`, and `optionLimit`. It rejects appointment type, options, unknown keys, empty bodies, bad values, and malformed JSON.
- The route checks the exact canonical Origin first, validates route params and body, reads the Better Auth session, and requires a manager row already bound to that user.
- Owners and bound co-organizers can update details. Missing sessions return `UNAUTHENTICATED`; unbound or unknown users return `FORBIDDEN`; missing appointments return the existing `NOT_FOUND` service response.
- Shared detail validation now serves appointment creation and updates with the same title, description, and option-limit rules.
- Finalized appointments return `APPOINTMENT_FINALIZED`. A requested limit below the live option count returns `LIMIT_BELOW_CURRENT_COUNT`; a limit equal to the count succeeds.
- The command compares submitted values in one immediate transaction. A no-op returns the current `{ revision }` without reading the clock, changing `updatedAt`, writing a row, or publishing an event.
- A changed patch uses one injected clock value and one SQL update statement for all changed fields, `updatedAt`, and the single revision increment. Trigger-forced failure tests prove the full patch rolls back.
- Revision publication runs only after a changed commit. Publisher exceptions do not change the successful command response or committed state.
- The production `[publicId]` route exports only `PATCH`; no type or option mutation service path was added.

## Concerns

None.
