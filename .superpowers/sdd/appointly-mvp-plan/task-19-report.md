# Task 19 Report: Manager participant enrollment

## Scope

Implemented only owner linkage, bound-manager participant enrollment, manager participation permission gates, the manager-participant POST route, and the small shared event/context/origin/route support needed to compose that route. Co-organizer invite, removal, and pending binding remain out of scope.

## RED evidence

Focused command:

```text
npm exec vitest run -- src/features/appointments/server/create-appointment.test.ts src/features/appointments/server/management.test.ts src/features/appointments/server/authorization.test.ts src/features/appointments/server/event-publisher.test.ts 'src/app/api/appointments/[publicId]/manager-participant/route-handler.test.ts'
```

The first run failed as expected because the owner insertion helper, manager enrollment commands, display-name derivation, permission helpers, in-process publisher, and injected route handler did not exist. Vitest reported failures in the authorization and management suites and module-load failures for the new event publisher and route handler.

## GREEN evidence

Node runtime: `v24.13.0`.

The focused Node 24 run passed:

```text
Test Files  5 passed (5)
Tests       31 passed (31)
```

The focused cases cover:

- owner manager and linked participant insertion inside the caller's immediate transaction;
- normalized Google name selection with email-local-part fallback;
- bound-manager reuse, creation, name conflict, participant cap, finalized state, non-manager refusal, one revision increment, and publish-after-commit observation;
- manual idempotent and created service results plus all three conflict codes;
- strict route params and request bodies, Better Auth session identity, bound-manager authorization, exact Origin rejection, 200/201 status selection, and stable JSON error wrappers;
- owner and co-organizer management permissions before and after enrollment, finalized gating, and per-option own-delete eligibility;
- synchronous publish/subscribe and unsubscribe behavior.

Full TypeScript check under Node 24:

```text
node node_modules/typescript/bin/tsc --noEmit
EXIT=0
```

No formatter, linter, build, or project-wide test suite ran.

## Implementation notes

- `insertOwnerManagerAndParticipant` accepts `TransactionContext`, so Task 23 can call it inside its appointment transaction without nesting another transaction.
- Automatic and manual enrollment both resolve the appointment and bound manager inside `runImmediate`. They check an existing user-linked participant before finalized or capacity rules.
- New enrollment inserts one participant and increments the appointment revision once. The event is published only after `runImmediate` returns.
- The production route uses the Better Auth session reader, the exact configured app origin, one production `ServiceContext`, and the real synchronous in-process publisher.
- No pending manager row is bound or changed by this task.

## Review fix round 1

RED under Node 24 added two regressions. Both failed because a subscriber error escaped `publish`: the publisher test reported `subscriber failed`, and `createManagerParticipant` threw after its transaction had committed.

GREEN under Node 24:

```text
Test Files  2 passed (2)
Tests       17 passed (17)
```

The in-process publisher now removes a listener that throws, continues notifying the other listeners for that revision, and does not let the listener error change the result of a committed enrollment.

## Review fix round 2

RED under Node 24 reproduced the stale unsubscribe bug: after a throwing listener was removed and a replacement listener subscribed, calling the old unsubscribe closure removed the replacement set and the replacement received no event.

GREEN under Node 24:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

Both unsubscribe and publish cleanup now remove the appointment map entry only when it still points to the listener set being cleaned up.
