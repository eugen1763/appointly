# Task 23 Report

## Status

Complete. Appointment creation now commits the appointment, owner manager and participant, pending co-organizers, initial options, and owner `YES` responses in one synchronous immediate SQLite transaction. The root `POST /api/appointments` route uses the shared production service context, Better Auth session reader, exact configured Origin, strict existing body schema, and canonical `appOrigin` URL.

## RED evidence

- `npx vitest run src/features/appointments/server/create-appointment.test.ts`
  - 21 tests collected.
  - 20 new command tests failed because `createAppointment` did not exist; the prior owner-helper test passed.
- `npx vitest run src/app/api/appointments/route-handler.test.ts src/app/api/appointments/route.test.ts`
  - Both suites failed to load because the root route handler and production route did not exist.

The failing tests covered the full graph, all four option storage kinds, one shared timestamp, owner creator and response links, normalized pending managers, event order, token length and collision bounds, stable conflicts, rollback, route Origin/body/auth handling, exact identity input, service error wrapping, response shape, canonical URL, and production wiring.

## GREEN evidence

Runtime proof:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node --version
v24.13.0
```

Focused command:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/vitest/vitest.mjs run \
  src/features/appointments/server/create-appointment.test.ts \
  src/features/appointments/server/option-storage.test.ts \
  src/features/appointments/server/transactions.test.ts \
  src/app/api/appointments/route-handler.test.ts \
  src/app/api/appointments/route.test.ts
```

Result: 5 files passed, 54 tests passed, 0 failed.

TypeScript command:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

Result: passed with no output.

## Design notes

- `createAppointment` is synchronous and accepts only an injected `ServiceContext` plus the parsed appointment and raw owner identity.
- Stable business failures are checked before writes when possible.
- Timed strings receive only the minimal `Date.parse` conversion and safe-integer storage check. Strict syntax, zone, future, and date validity remain for Tasks 24–25.
- Each public-ID attempt requires an exact 32-byte injected token and encodes only its first 18 bytes. Allocation stops after eight collisions.
- All graph writes use one `clock.now()` result. Event revision 1 publishes only after `runImmediate` returns.
- Transaction failures become stable app errors; HTTP responses do not expose SQLite causes.
- The route response contains only `publicId`, `publicUrl`, and revision 1.

## Review and concerns

A focused read-only code review found no correctness, security, transaction, error-shaping, token-allocation, route-wiring, or scope defects. No open concerns remain.

## Independent review fix round 1

Three later independent-review findings were reproduced with new RED tests:

- Shared title validation accepted whitespace-only titles: 3 failures out of 132 collected tests across validation, contracts, and the live-SQLite creation service.
- Runtime clock, entropy, allocation, and SQLite faults used the client-facing `VALIDATION_FAILED` code, and publication failure escaped after commit: 13 failures out of 132 collected tests across HTTP errors, contracts, the creation service, and the route handler.

The fixes make whitespace-only titles invalid without changing valid plain text; add stable, non-leaking `INTERNAL_ERROR` responses at HTTP 500; retain internal causes only on the server; keep deterministic field and option-storage failures at HTTP 400; and treat post-commit event publication as best-effort invalidation.

GREEN evidence under Node 24.13.0:

- Title wave: 132 passed, 0 failed.
- Internal-fault and publisher wave: 132 passed, 0 failed.
- Full `tsc --noEmit`: passed with no output.

Final focused verification: 8 files passed, 199 tests passed, 0 failed; full `tsc --noEmit` passed in the same Node 24.13.0 run.
