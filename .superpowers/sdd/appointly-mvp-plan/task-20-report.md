# Task 20 report

## Scope

Implemented the co-organizer lifecycle in `server/management.ts`, owner and co-organizer permission rules in `server/authorization.ts`, pending-email binding in Task 19 enrollment, and injected plus production manager route handlers.

No appointment deletion command, dashboard UI, snapshot UI, response or option command, or finalization command was added.

## RED evidence

Focused tests were written and run before each production change.

- The first lifecycle run failed all 13 tests: `inviteCoOrganizer`, `listAppointmentManagers`, `removeCoOrganizer`, and `bindPendingManagersForDashboard` did not exist, and pending appointment access returned `FORBIDDEN`.
- The authorization run failed the two new deletion authorization tests because `assertAppointmentDeletionAuthorized` did not exist. The existing permission behavior passed; the suite was expanded to cover all eight active/finalized, owner/co-organizer, enrolled/unenrolled combinations.
- The first manager route run failed both suites because the GET/POST and DELETE handler factories did not exist.
- The pending manual enrollment test failed with `FORBIDDEN` before `createManagerParticipant` accepted and bound the raw session email in its immediate transaction.
- The normalized Better Auth lookup test failed with `PENDING` instead of `BOUND` when the stored user email had mixed case and ASCII outer whitespace.

## GREEN implementation

- Invite normalizes the email, checks existing manager email or bound user before the 20-co-organizer cap, binds an existing Better Auth user, and otherwise inserts a pending row.
- Owner-only private list order is `createdAt`, then manager ID. It reports private email, `PENDING` or `BOUND`, and owner/co-organizer removal flags.
- Removal rejects the owner row, nonowners, finalized appointments, and unknown manager IDs. It deletes only the manager row, so linked participants, responses, and option ownership remain intact.
- Pending appointment access binds by normalized session email and performs participant reuse, automatic creation, name-conflict reporting, or participant-cap reporting in one immediate transaction. Binding plus enrollment increments the appointment once and publishes once after commit.
- Manual manager enrollment also binds a pending matching session email in the same immediate transaction and avoids a second revision.
- Dashboard binding binds all matching pending rows in one immediate transaction, increments each changed appointment once, and publishes each committed revision after the transaction.
- Owner deletion authorization requires the owner role and exact title equality. No delete command was implemented.
- GET and POST `/api/appointments/[publicId]/managers` and DELETE `/api/appointments/[publicId]/managers/[managerId]` use injected factories, production context, raw Better Auth session identity, strict params and bodies, exact mutation origins, stable error wrappers, and the contract success shapes.

## Review fix round 1

RED added pending-manager conflict cases for finalized state, taken participant name, and the 200-participant cap, plus a route-level conflict persistence case. All four failed because the immediate transaction rolled back the pending binding.

GREEN now returns a conflict outcome from the immediate transaction when that transaction first binds the manager. It increments once, commits, publishes after commit, and then throws the original stable `AppError` outside the transaction. The already-bound conflict cases still throw inside the transaction with no revision change or publish.

## Verification

Node `24.13.0` was used for focused verification.

- Focused Vitest command: six Task 19/20 service and route files, 66 tests passed.
- Full TypeScript check: `tsc --noEmit` exited 0.

Formatters, linters, builds, and project-wide test suites were not run, as required.
