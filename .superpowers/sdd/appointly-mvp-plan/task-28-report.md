# Task 28 report

## Status

Implemented the live-SQLite participant join transaction, strict guest-or-pending-manager response contract, production route and cookie handling, and the public display-name join form with one-time private-link copy state.

## Security and actor behavior

- Anonymous visitors and unrelated signed-in users create unlinked guest participants.
- Matching pending co-organizers bind by normalized Better Auth session email and link the new participant to the session user ID in the same immediate transaction.
- Bound managers, linked authenticated participants, and browsers with existing valid access for the appointment receive `FORBIDDEN`.
- Valid guest sessions are reused across appointments without extending expiry or resetting the cookie. Missing, unknown, malformed, or expired cookies cause a new fixed-lifetime session.
- Edit and session tokens come from separate factory calls, must each contain exactly 32 bytes, and cannot equal each other.
- SQLite stores only 32-byte domain-separated HMAC-SHA-256 BLOB digests. Guest edit tokens appear once in the fragment URL; session tokens appear only in the HttpOnly cookie. Pending-manager joins create neither.
- Appointment, participant, manager binding, session, access, and revision writes run in one immediate transaction with one clock value and one revision increment. Failures roll back all graph and event effects. Publishing occurs after commit and publisher failures remain isolated.

## Contract and route

The strict 201 response accepts exactly one of:

- guest: `{ participantId, editUrl, revision }`
- pending manager: `{ participantId, revision }`

Extra discriminators, session tokens, and other keys fail schema parsing. The route checks exact Origin before params, JSON, cookies, auth session, or database work. New guest sessions set `appointly_guest_session` with `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=31536000`, and `Secure` only for HTTPS.

## RED-GREEN evidence

All commands used Node `v24.13.0`.

- RED: 5 test files failed; 93 tests collected; 75 passed and 18 failed. The two missing production modules failed before their component and route tests could collect. Failures covered the old guest-only success schema, absent join service/route/form, and absent public-page integration.
- GREEN: 5 test files passed; 103 tests passed and 0 failed.
- TypeScript: full `tsc --noEmit` exited 0 with 0 errors.

Focused files:

- `src/features/appointments/contracts.test.ts` — 70 passed
- `src/features/appointments/server/guest-access.test.ts` — 16 passed
- `src/app/api/appointments/[publicId]/participants/route-handler.test.ts` — 6 passed
- `src/app/a/[publicId]/JoinParticipantForm.test.tsx` — 4 passed
- `src/app/a/[publicId]/PublicAppointmentView.test.tsx` — 7 passed

## Browser smoke evidence

Ran the Next dev server under Node `v24.13.0` against a migrated live SQLite file and stopped it after both flows.

### Guest

- POST returned 201 with exactly `editUrl`, `participantId`, and `revision`; revision became 2.
- The edit URL matched the required participant-and-43-character-token fragment form.
- The response set one 43-character guest cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, and a 365-day max age. `Secure` was false for the HTTP smoke origin.
- The DOM showed “Save your private edit link,” the once-only notice, the private link, and “Copy private link.”
- SQLite showed an unlinked guest, a 32-byte BLOB edit digest, one 32-byte BLOB session digest, and one access row.
- Browser console and page errors: 0.

### Pending co-organizer

- A fresh isolated browser signed in through Better Auth's normal email sign-up endpoint.
- POST returned 201 with exactly `participantId` and `revision`; revision became 2.
- The response had no `Set-Cookie`; the isolated browser had zero guest cookies before and after the join.
- The DOM showed “You joined as a co-organizer” and no private link or copy action.
- SQLite showed the manager and participant bound to the same Better Auth user, with a null edit digest and no added guest session/access row.
- Browser console and page errors: 0.

## Concern

Next dev emitted the existing instrumentation Edge-runtime warnings while compiling. Both public pages returned 200, both join routes returned 201, the browser consoles had no errors, and this task did not change instrumentation.


## Independent review fix round 1

The join service now receives an explicit `GuestTokenDigester`. Live service and route-handler tests create it from a fixed test key and do not read application environment state. Only production route wiring decodes the already validated `GUEST_TOKEN_SECRET` and creates the provider.

Unexpected token factory values or throws, digest-provider throws, clock throws, and SQLite/transaction faults map to the same non-leaking `500 INTERNAL_ERROR` body. Route dependency failures use the same mapping. Stable client and domain errors remain unchanged.

Late SQLite triggers now force and verify rollback after pending-manager binding, after guest session and participant insertion, and at the final appointment revision update. Each test checks all earlier graph rows, manager binding, revision, and event publication. Tests also digest the same raw token through both domains and reject equal edit/session factory output before commit.

The client parses every 2xx join body with `joinParticipantSuccessSchema`. Extra-key, truncated, and malformed JSON responses preserve the form and show the generic error.

Clean-shell focused command:

```sh
env -u APP_URL -u BETTER_AUTH_SECRET -u GUEST_TOKEN_SECRET \
  -u GOOGLE_CLIENT_ID -u GOOGLE_CLIENT_SECRET -u DATABASE_PATH \
  -u TRUST_PROXY \
  /tmp/appointly-node24/node_modules/node-linux-x64/bin/node \
  node_modules/vitest/vitest.mjs run \
  src/features/appointments/contracts.test.ts \
  src/features/appointments/server/guest-access.test.ts \
  'src/app/api/appointments/[publicId]/participants/route-handler.test.ts' \
  'src/app/a/[publicId]/JoinParticipantForm.test.tsx' \
  'src/app/a/[publicId]/PublicAppointmentView.test.tsx'
```

- Review RED: 4 of 5 files failed; 84 tests collected, 81 passed and 3 failed; 2 suites did not collect because the injected provider API was absent.
- Review GREEN: 5 of 5 files passed; 112 tests passed and 0 failed.
- Clean-shell full TypeScript: `tsc --noEmit` exited 0 with 0 errors.