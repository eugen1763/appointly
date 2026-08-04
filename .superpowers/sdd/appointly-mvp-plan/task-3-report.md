# Task 3 Report: Strict environment and HMAC configuration

## Status

Implemented the shared runtime environment and HMAC foundation under `src/lib`, with one focused Vitest file and a task-only Vitest config. No database, auth, route, or appointment-domain behavior was added.

## Files

- `src/lib/env.ts`
  - Exports `RuntimeEnv`, `parseEnv(source)`, and lazy cached `getEnv()`.
  - Keeps `APP_URL` as the configured canonical origin and exposes the same string as `appOrigin`.
  - Validates all required values, both secrets, `TRUST_PROXY`, and `DATABASE_PATH`.
- `src/lib/security.ts`
  - Exports `EDIT_HMAC_DOMAIN`, `SESSION_HMAC_DOMAIN`, `RATE_HMAC_DOMAIN`, and `DELETE_HMAC_DOMAIN`.
  - Exports `deriveDomainKey(domain)`, `digestBinaryToken(domain, token)`, and `digestTextParts(domain, ...parts)`.
  - Keeps the decoded guest master secret and cached domain keys private.
- `src/lib/environment-security.test.ts` contains the focused behavior tests.
- `vitest.task-3.config.mts` limits Vitest to the Task 3 test file and the Node environment.
- `.env.example` documents all required values, the exact secret command, and both callback forms. It does not document `E2E_AUTH`.

## RED and GREEN evidence

All commands used Node 24 through:

```text
PATH=/tmp/appointly-node24/node_modules/node/bin:/tmp/appointly-npm11/node_modules/.bin:/usr/bin:/bin
```

### Canonical `APP_URL`

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t APP_URL
FAIL: Cannot find module './env'
Test Files 1 failed (1)
```

The test file existed first; the failure came from the missing environment module.

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t APP_URL
Test Files 1 passed (1)
Tests 11 passed | 35 skipped (46)
```

### Required values

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "required environment values"
Test Files 1 failed (1)
Tests 8 failed | 1 passed | 37 skipped (46)
```

The eight failures showed that absent non-URL values and blank Google credentials did not yet throw.

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "required environment values"
Test Files 1 passed (1)
Tests 9 passed | 37 skipped (46)
```

### Base64url secrets

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "base64url secrets"
Test Files 1 failed (1)
Tests 8 failed | 2 passed | 36 skipped (46)
```

Padding, invalid characters, short decoded lengths, and impossible unpadded lengths were still accepted.

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "base64url secrets"
Test Files 1 passed (1)
Tests 10 passed | 36 skipped (46)
```

### Strict `TRUST_PROXY`

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t TRUST_PROXY
Test Files 1 failed (1)
Tests 6 failed | 4 passed | 36 skipped (46)
```

The six failures showed that non-exact nonempty spellings were being treated as false instead of rejected.

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t TRUST_PROXY
Test Files 1 passed (1)
Tests 10 passed | 36 skipped (46)
```

### Writable `DATABASE_PATH`

First RED/GREEN cycle:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t DATABASE_PATH
RED: Tests 2 failed | 2 passed | 42 skipped (46)
GREEN: Tests 4 passed | 42 skipped (46)
```

The failures showed that missing and non-writable parents were accepted.

Second RED/GREEN cycle:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t DATABASE_PATH
RED: Tests 2 failed | 4 passed | 42 skipped (48)
GREEN: Tests 6 passed | 42 skipped (48)
```

The failures showed that an existing read-only file and a directory used as the database path were accepted. Tests changed permissions and created files only inside test-owned temporary directories. Production validation uses metadata and access checks and creates nothing.

### Lazy environment cache

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "caches one validated runtime environment"
Test Files 1 failed (1)
Error: Runtime environment caching is not implemented
```

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "caches one validated runtime environment"
Test Files 1 passed (1)
Tests 1 passed | 47 skipped (48)
```

### Exact HMAC domains and keys

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "derives keys from all four exact domain prefixes"
Test Files 1 failed (1)
AssertionError: expected '' to be 'appointly/edit/v1'
```

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "derives keys from all four exact domain prefixes"
Test Files 1 passed (1)
Tests 1 passed | 47 skipped (48)
```

The test checks literal, independently generated SHA-256 HMAC fixtures for all four keys.

### Binary token digest

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "digests a binary token"
Test Files 1 failed (1)
Error: Binary token digests are not implemented
```

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "digests a binary token"
Test Files 1 passed (1)
Tests 1 passed | 47 skipped (48)
```

### Collision-safe UTF-8 text parts

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "prefixes each variable text part"
Test Files 1 failed (1)
Error: Text-part digests are not implemented
```

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.ts -t "prefixes each variable text part"
Test Files 1 passed (1)
Tests 1 passed | 47 skipped (48)
```

The focused file also checks a multibyte `é` fixture, proving the prefix uses UTF-8 byte count rather than JavaScript string length. The collision fixtures for `("ab", "c")` and `("a", "bc")` produce distinct, independently generated digests.

### Self-review hardening

Review found that a caller could mutate the cached environment before the first HMAC call and that a database parent needs both write and child-search access.

RED:

```text
npm exec -- vitest run --config vitest.task-3.config.mts -t "writable parent that cannot search|freezes the cached environment"
Test Files 1 failed (1)
Tests 2 failed | 48 skipped (50)
RED_EXIT=1
```

GREEN:

```text
npm exec -- vitest run --config vitest.task-3.config.mts -t "writable parent that cannot search|freezes the cached environment"
Test Files 1 passed (1)
Tests 2 passed | 48 skipped (50)
GREEN_EXIT=0
```

`RuntimeEnv` fields are now read-only, `getEnv()` freezes its one cached object, and parent validation requires `W_OK | X_OK`. Permission tests detect whether the current process can bypass mode bits, so they remain valid when run with elevated privileges.

## Final verification

Focused tests and focused TypeScript check ran together after the config moved to `.mts`:

```text
npm exec -- vitest run --config vitest.task-3.config.mts
Test Files 1 passed (1)
Tests 50 passed (50)

npm exec -- tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module esnext --moduleResolution bundler --types node,vitest/globals src/lib/env.ts src/lib/security.ts src/lib/environment-security.test.ts vitest.task-3.config.mts
TEST_EXIT=0 TYPECHECK_EXIT=0
```

The first focused TypeScript attempt omitted the TypeScript 7 `--ignoreConfig` switch and returned `TS5112`; the corrected focused command above passed with no output.

## Acceptance review

- `APP_URL` rejects credentials, non-root paths, queries, fragments, trailing slashes, non-HTTP schemes, and spellings that the URL parser would normalize. The returned `APP_URL` equals `url.origin`, and `appOrigin` equals it.
- Both secrets reject padding, invalid characters, impossible unpadded lengths, noncanonical trailing bits, and values that decode to fewer than 32 bytes.
- Environment validation computes decoded secret size without decoding. The security module decodes `GUEST_TOKEN_SECRET` once on first HMAC use and does not export the master bytes or its private key cache. The cached `RuntimeEnv` is read-only and frozen before any caller can see it.
- All seven required values fail closed. `TRUST_PROXY` accepts only exact `true` and `false`.
- `DATABASE_PATH` checks write and child-search access on its parent and, when present, requires a writable regular file without creating or changing any production path.
- Domain keys derive with HMAC-SHA-256 from the four exact UTF-8 prefixes. Public key results are copies, so callers cannot mutate the private cached keys.
- Binary tokens hash directly under their domain key. Every variable text part hashes as a four-byte big-endian unsigned length followed by its UTF-8 bytes.
- `.env.example` contains the exact secret command and callback strings, no real secret, and no `E2E_AUTH`.

## Self-review

The focused suite covers realistic mutations: accepting normalized origins, accepting padded or short secrets, coercing proxy values, skipping write checks, changing a domain prefix, sharing a key, hashing raw concatenated text, using UTF-16 string length, or hashing binary data under the wrong key. No task-owned code writes to the filesystem. No unrelated behavior or global project configuration changed.

## Concerns

None.

## Review fix round 1

Added focused cases for a valid unpadded secret that decodes to 33 bytes and a 32-byte encoding with nonzero unused trailing bits.

To prove the trailing-bit case catches a plausible bug, `!hasCanonicalTrailingBits ||` was removed only for this RED run and restored at once:

```text
npm exec -- vitest run --config vitest.task-3.config.mts -t "rejects noncanonical trailing bits"

Test Files  1 failed (1)
Tests  2 failed | 52 skipped (54)
RED_EXIT=1
```

To prove the longer-secret case catches an accidental exact-length check, the decoded-length comparison was changed only for this RED run from `< 32` to `!== 32` and restored at once:

```text
npm exec -- vitest run --config vitest.task-3.config.mts -t "decodes to more than 32 bytes"

Test Files  1 failed (1)
Tests  2 failed | 52 skipped (54)
RED_EXIT=1
```

Both restored production behaviors passed together:

```text
npm exec -- vitest run --config vitest.task-3.config.mts -t "rejects noncanonical trailing bits|decodes to more than 32 bytes"

Test Files  1 passed (1)
Tests  4 passed | 50 skipped (54)
GREEN_EXIT=0
```

Final focused verification:

```text
npm exec -- vitest run --config vitest.task-3.config.mts

Test Files  1 passed (1)
Tests  54 passed (54)

npm exec -- tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module esnext --moduleResolution bundler --types node,vitest/globals src/lib/env.ts src/lib/security.ts src/lib/environment-security.test.ts vitest.task-3.config.mts

TEST_EXIT=0 TYPECHECK_EXIT=0
```

The temporary production mutations were fully restored before GREEN and were not committed.


## Full-project typecheck fixture fix

Next's project declarations require `NodeJS.ProcessEnv.NODE_ENV`. The typed `validSource()` test fixture omitted it.

RED under Node 24:

```text
export PATH=/tmp/appointly-node24/node_modules/node/bin:/tmp/appointly-npm11/node_modules/.bin:/usr/bin:/bin
node --version
v24.13.0
npm --version
11.6.2
npm run typecheck

> appointly@0.1.0 typecheck
> tsc --noEmit

src/lib/environment-security.test.ts(32,3): error TS2741: Property 'NODE_ENV' is missing in type '{ APP_URL: string; BETTER_AUTH_SECRET: string; GUEST_TOKEN_SECRET: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; DATABASE_PATH: string; TRUST_PROXY: string; }' but required in type 'ProcessEnv'.
TYPECHECK_EXIT=1
```

GREEN after adding `NODE_ENV: "test"` to that fixture:

```text
export PATH=/tmp/appointly-node24/node_modules/node/bin:/tmp/appointly-npm11/node_modules/.bin:/usr/bin:/bin
node --version
v24.13.0
npm --version
11.6.2
npm exec -- vitest run --config vitest.task-3.config.mts src/lib/environment-security.test.ts

RUN  v4.1.10 /home/finn/code/appointly
✓ src/lib/environment-security.test.ts (54 tests) 13ms

Test Files  1 passed (1)
Tests  54 passed (54)
Start at  19:49:25
Duration  127ms (transform 25ms, setup 0ms, import 38ms, tests 13ms, environment 0ms)
FOCUSED_TEST_EXIT=0

npm run typecheck

> appointly@0.1.0 typecheck
> tsc --noEmit

TYPECHECK_EXIT=0
```