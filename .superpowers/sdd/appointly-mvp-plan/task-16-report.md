# Task 16 Report: Appointment route contracts

## Status

Complete. `src/features/appointments/contracts.ts` defines the seven approved plan types, strict Zod schemas, the guest cookie and actor contracts, and one typed entry for each of the 17 planned routes. The focused contract suite has 64 passing tests, and the full TypeScript check passes under Node 24.13.0.

## Files

- Added `src/features/appointments/contracts.ts`.
- Added `src/features/appointments/contracts.test.ts`.
- Added this report.

No route handler, service, date conversion, time-zone validity check, formatter, linter, build, or project-wide test was added or run.

## RED evidence

The focused test file was written before `contracts.ts` existed.

Command:

```text
npx vitest run src/features/appointments/contracts.test.ts
```

Observed result:

```text
FAIL src/features/appointments/contracts.test.ts
Error: Cannot find module './contracts'
Test Files 1 failed (1)
EXIT=1
```

This was the expected RED result: the new public contract module did not exist.

## GREEN evidence

The workstation default was Node 26.5.0, so final checks used a temporary exact Node 24.13.0 binary at `/tmp/appointly-node24/node_modules/node-linux-x64/bin/node`. No project dependency or tracked runtime setting changed.

Command:

```text
export PATH=/tmp/appointly-node24/node_modules/node-linux-x64/bin:$PATH
node --version
./node_modules/.bin/vitest run src/features/appointments/contracts.test.ts
./node_modules/.bin/tsc --noEmit
```

Observed result:

```text
v24.13.0
✓ src/features/appointments/contracts.test.ts (64 tests)
Test Files 1 passed (1)
Tests 64 passed (64)
TEST_EXIT=0 TYPECHECK_EXIT=0
```

## Contract coverage

### Exact plan types

Type-level equality checks cover:

1. `OptionInput`
2. `CreateAppointmentInput`
3. `AddOptionRequest`
4. `DeleteOptionRequest`
5. `OptionValue`
6. `ActorContext`
7. `AppointmentSnapshot`

The snapshot type and strict runtime schema expose only the approved public fields. Tests reject owner user IDs, normalized manager email fields, participant edit-token hashes, guest-session hashes, rate-limit keys, Better Auth account data, mixed option fields, missing permissions, and unknown nested fields.

### Strict request and value schemas

Tests cover all four `OptionInput` shapes and all four stored `OptionValue` shapes. Each discriminated member is strict, so fields from another option kind and unknown fields fail. The input schemas keep date and timed values as strings and do not implement calendar syntax, IANA-zone checks, future rules, or UTC conversion; those remain Task 24 work.

Request tests cover:

- title, description, display-name, co-organizer-count, and option-limit bounds from Task 13;
- one or more create options, option count within the chosen limit, and option kind matching the immutable appointment type;
- valid and unique normalized co-organizer emails;
- strict patch fields and the at-least-one-field rule;
- strict delete, manager, manager-participant, participant join, guest-access, response, option, and finalize bodies;
- UUIDv4 participant and option identifiers;
- exact response values `YES`, `NO`, and `null`;
- explicit `undefined` schemas for routes with no request body.

### Route matrix

`appointmentRouteContracts` has exactly these 17 entries:

1. `createAppointment`
2. `getSnapshot`
3. `getEvents`
4. `updateAppointment`
5. `deleteAppointment`
6. `listManagers`
7. `addManager`
8. `deleteManager`
9. `createManagerParticipant`
10. `joinParticipant`
11. `exchangeGuestAccess`
12. `resetParticipantLink`
13. `putResponse`
14. `addOption`
15. `deleteOption`
16. `finalizeAppointment`
17. `reopenAppointment`

Each entry records its exact method and plan path, actor requirement, request location and schema, success status or statuses, JSON/no-body/event-stream result, and a closed Zod error-code enum constrained by Task 15's `AppErrorCode`.

The no-body request cases are events, manager list, manager delete, reset-link, and reopen. Appointment deletion records 204 with an explicit no-body schema. Events records a 200 event stream and `null` JSON schema. Manager-participant records both 200 for the idempotent result and 201 for creation.

### Revisions, cookie, actors, and errors

Tests parse every surviving mutation result and then prove that deleting its `revision` makes validation fail. Appointment deletion has 204/no body. Guest access returns only `participantId`, and its strict schema rejects `revision` because the exchange does not mutate appointment state.

The guest cookie schema requires:

- name `appointly_guest_session`;
- an unpadded 43-character base64url value representing 32 bytes;
- `HttpOnly=true`;
- `SameSite=Lax`;
- `Path=/`;
- `Max-Age=31536000`;
- a required boolean `Secure` value chosen from the configured app origin.

The route matrix records an unconditional cookie set after guest join and a conditional set after guest token exchange when no valid session exists.

Actor requirements form a closed enum: public, authenticated, manager, owner, bound manager, non-manager visitor without participant access, and participant. Route error schemas reject codes outside each route's approved union and derive their type from the existing Task 15 `AppErrorCode`; no second app error-code set exists.

## Self-review

- Confirmed the matrix test compares the exact ordered set of 17 named entries, methods, paths, actors, request locations, success statuses, and response body kinds.
- Confirmed every structural object schema is strict, including discriminated option members and every nested snapshot object.
- Confirmed every planned mutation success either requires `revision`, is appointment deletion with 204/no body, or is guest access with no appointment revision.
- Confirmed public snapshot fields match the plan and tests reject public secret fields at both type and runtime boundaries.
- Confirmed the contracts import Task 13 limits and Task 15 `AppErrorCode` rather than defining replacements.
- Confirmed Task 24 calendar and time-zone behavior does not appear in this change.

## Concerns

The workstation default `node` is 26.5.0 rather than the project-required Node 24 line. Final focused tests and typecheck were therefore run with an exact temporary Node 24.13.0 binary, and both exited successfully. This does not change tracked project files.

## Review fix round 1

### RED

Focused tests were added before the fixes for all three review findings. Under Node 24.13.0:

```text
./node_modules/.bin/vitest run src/features/appointments/contracts.test.ts
```

Observed result:

```text
src/features/appointments/contracts.test.ts (68 tests | 5 failed)
EXIT=1
```

The five expected failures covered normalized display-name length, reusable strict route params, revised closed error-code sets, strict wrapped route error bodies, and exact option-delete confirmation details.

### GREEN

The contract now exports strict empty, appointment, manager, participant, and option path-param schemas and attaches one to every route. `getEvents` can validate its public ID before stream headers. Path-only routes include `VALIDATION_FAILED`; guest-access keeps malformed path or body input within its fixed `INVALID_EDIT_LINK` union.

Display-name request validation now checks the normalized display value while returning the original request text unchanged. Whitespace-only values fail, while a short normalized value with long trailing whitespace passes.

Each route now carries a closed code schema, a strict error-body schema, and Task 15 status mappings. Error bodies use the exact strict `{ error: { code, message, fieldErrors?, details? } }` wrapper. Only the two option-delete confirmation codes accept `details`; their strict details require a positive count, the same number of names, and one 43-character opaque token.

Observed Node 24.13.0 results:

```text
✓ src/features/appointments/contracts.test.ts (68 tests)
Test Files 1 passed (1)
Tests 68 passed (68)
EXIT=0

./node_modules/.bin/tsc --noEmit
EXIT=0
```
