# Task 15 Report: Stable HTTP error responses

## Scope

Added one shared app-owned HTTP error module and one focused test file. No route handler, domain command, Better Auth wrapper, or SSE stream code changed.

## Design

- `APP_ERROR_STATUS` is the sole list of app error codes and the sole status map.
- `AppErrorCode` derives from that frozen record, so the union stays closed without a second source of code names.
- `AppError` holds the caller's public code and message plus optional public validation and detail data. It may retain a raw `cause` for server-side use.
- `appErrorResponse` selects only public fields when it builds the exact `{ error: ... }` JSON body. It derives status from `APP_ERROR_STATUS`, fixes `Content-Type` to `application/json`, and accepts extra headers without accepting a status override.

## RED evidence

Command run with Node `v24.13.0`:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/vitest/vitest.mjs run src/features/appointments/http-errors.test.ts
```

Result before `http-errors.ts` existed:

```text
FAIL src/features/appointments/http-errors.test.ts
Error: Cannot find module './http-errors'
Test Files 1 failed (1)
EXIT=1
```

The failure matched the missing shared error module.

## GREEN evidence

Focused test command run with Node `v24.13.0`:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/vitest/vitest.mjs run src/features/appointments/http-errors.test.ts
```

Result:

```text
Test Files 1 passed (1)
Tests 27 passed (27)
EXIT=0
```

The focused tests cover:

- all 19 named codes and each exact 400, 401, 403, 404, 409, or 429 status;
- the exact single `error` wrapper and caller-supplied message;
- omission and explicit inclusion of `fieldErrors` and `details`, including empty objects;
- extra response headers such as `Retry-After`;
- fixed `application/json` content type;
- exclusion of causes, stacks, arbitrary attached context, and raw secrets from JSON.

## Typecheck evidence

Full TypeScript check run with Node `v24.13.0`:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

Result: `EXIT=0` with no type errors.

## Self-review

- The source lists each code once. `AppErrorCode` derives from the authoritative frozen status record.
- Callers cannot override the mapped HTTP status or JSON content type through the response helper.
- Serialization copies only `code`, `message`, and supplied public optional fields; it does not serialize the error object itself.
- Tests use literal expected status and body values rather than values computed by the code under test.
- No formatter, linter, build, project-wide test suite, route handler, command behavior, Better Auth handling, or SSE stub was added or run.

## Concerns

None within Task 15 scope. The later events route must validate the public ID before sending stream headers and must close the stream on errors after it starts.
