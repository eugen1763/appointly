# Task 17 Report: Injected service context and migrations

## Status

Complete. Appointment server code now has one injected `ServiceContext`, synchronous IMMEDIATE transactions, all eight named module paths, and one checked-in migration for the four Better Auth tables and eight app tables.

## Files

- Added `src/features/appointments/server/service-context.ts`.
- Added `src/features/appointments/server/transactions.ts` and its focused test.
- Added empty module boundaries `create-appointment.ts`, `guest-access.ts`, `responses.ts`, `options.ts`, `management.ts`, `snapshot.ts`, and `authorization.ts`.
- Typed the existing Drizzle connection against the merged auth and app schema in `src/db/connection.ts` without changing its timeout, WAL, foreign-key, or process-wide lifetime rules.
- Added migration application checks in `src/db/migration.test.ts`.
- Added missing child foreign-key lookup indexes in `src/db/schema.ts`.
- Generated `drizzle/0000_puzzling_maestro.sql`, `drizzle/meta/0000_snapshot.json`, and `drizzle/meta/_journal.json` with the pinned local `drizzle-kit` script.
- Added this report.

The seven future command files contain only `export {};`. They have no commands, fake publishers, imports, or hidden database access.

## Service and transaction contract

`ServiceContext` injects:

- the fully typed Drizzle database;
- the `better-sqlite3` handle;
- a millisecond clock;
- a token factory;
- a synchronous event publisher.

`createProductionServiceContext` requires an event publisher argument. It uses the existing process-wide connection, `Date.now`, and `randomBytes(32)`. There is no default or no-op publisher.

`runImmediate` builds an operation context without `eventPublisher`, invokes the operation within `better-sqlite3`'s `.transaction(...).immediate()` wrapper, rejects Promise-like output before commit, and returns the synchronous result. It never publishes.

## RED evidence

The first transaction run occurred before either new module existed:

```text
FAIL src/features/appointments/server/transactions.test.ts
Error: Cannot find module './service-context'
Test Files 1 failed (1)
EXIT=1
```

The first fresh migration run occurred before `drizzle/` existed:

```text
FAIL src/db/migration.test.ts
Error: Can't find meta/_journal.json file
Tests 1 failed (1)
EXIT=1
```

SQL review found uncovered foreign-key lookups. An `EXPLAIN QUERY PLAN` test first failed because guest access by participant caused a scan. After that fix, the wider check first failed for appointment owner/final-option lookup. The schema now has all three indexes.

```text
FAIL uses indexes for child foreign-key lookups not covered by parent-key indexes
AssertionError: expected false to be true
EXIT=1
```

Mutation checks proved that the tests guard transaction order and lock mode:

1. Replacing `.immediate()` with `.deferred()` made the lock test fail because a second connection acquired `BEGIN IMMEDIATE` during the operation.
2. Moving the operation outside the transaction made both rollback tests fail with persisted `rolled-back` and `async-write` rows.

The correct code was restored before final checks.

## GREEN evidence

All final commands used exact Node 24.13.0 from `/tmp/appointly-node24/node_modules/node-linux-x64/bin/node`.

Focused affected tests:

```text
✓ src/db/connection.test.ts (5 tests)
✓ src/db/migration.test.ts (2 tests)
✓ src/features/appointments/server/transactions.test.ts (6 tests)
Test Files 3 passed (3)
Tests 13 passed (13)
EXIT=0
```

The six transaction tests directly cover synchronous commit and return, rollback on throw, Promise rejection and rollback before commit, IMMEDIATE lock acquisition before the callback, deterministic injected clock and token bytes, publisher removal from the operation context, no publish call, the process connection, and 32-byte production tokens.

Full TypeScript check:

```text
node ./node_modules/typescript/bin/tsc --noEmit
EXIT=0
```

The existing five connection tests also pass, including the five-second timeout, required WAL mode, active and enforced foreign keys, isolated handles, and cleanup after WAL setup failure.

## Migration generation and SQL review

Generation used the pinned local script and a temporary database path; no `push` command ran:

```text
DATABASE_PATH=/tmp/appointly-task17-generate.sqlite \
  node /usr/lib/node_modules/npm/bin/npm-cli.js run db:generate
```

Drizzle reported 12 tables and wrote `drizzle/0000_puzzling_maestro.sql`.

The final SQL audit found:

- exactly 12 product tables: `user`, `session`, `account`, `verification`, `appointments`, `appointment_managers`, `participants`, `appointment_options`, `responses`, `guest_sessions`, `guest_session_access`, and `rate_limit_windows`;
- 24 named checks, including all four required 32-byte BLOB checks;
- 27 indexes, including the child foreign-key indexes not covered by primary or unique key prefixes;
- 14 foreign keys with 10 `CASCADE`, three `SET NULL`, and one `RESTRICT` delete action;
- all three required composite references for option creators and response participant/option ownership;
- no fixture, marker, `test_`, or other test-only table name.

The fresh application test uses Drizzle's runtime migrator on a new isolated file and confirms all 12 tables, `journal_mode=wal`, `foreign_keys=1`, and indexed child foreign-key query plans.

## Self-review

- Confirmed all eight exact named server files exist.
- Confirmed each future command boundary contains only `export {};`.
- Confirmed no command imports the process database and no fake command or publisher exists.
- Confirmed the production factory is the only new code that reads the process-wide connection.
- Confirmed the transaction operation receives `db`, `sqlite`, `clock`, and `tokenFactory`, but no publisher.
- Confirmed both success and error paths leave the publisher untouched.
- Confirmed the generated folder has one SQL migration, one snapshot, and one journal entry.
- Confirmed no formatter, linter, build, project-wide suite, or `drizzle-kit push` ran.

## Concerns

The workstation default Node is 26.5.0, so all final tests and typecheck used an isolated exact Node 24.13.0 binary. The system npm CLI is 12.0.1 and printed a compatibility warning when Node 24.13.0 launched it, but the script then ran the repository's pinned `drizzle-kit@0.31.10`, generated all artifacts, and exited 0. No tracked package changed.
