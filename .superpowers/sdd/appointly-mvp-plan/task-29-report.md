# Task 29 Report

## Status

Complete. Guest sessions now use one reusable, fixed-expiry lifecycle. Valid sessions are resolved without writes, reused without a new cookie, and limited to linked participants for the requested appointment. The public page reads the HttpOnly cookie on the server and sends only linked IDs and names to the client selector.

## Implementation

- Added canonical 32-byte unpadded base64url token parsing, safe fixed-year timestamp creation, valid-session lookup, and create-or-reuse decisions.
- Kept raw session tokens server-only. JSON and client props contain no session token or digest.
- Refactored participant join to reuse the lifecycle without moving its actor checks or immediate transaction.
- Added read-only linked-access resolution with strict expiry, appointment isolation, and participant `createdAt` then ID ordering.
- Added an appointment-scoped local-storage helper that stores only a UUID participant ID, handles unavailable storage, and clears unlinked choices.
- Added one-linked auto-selection and a labeled multiple-linked selector. Guest join success stores the returned participant ID.
- Reused one production guest-token digester in the join route and public page.

## Verification

All commands used Node 24.13.0.

### RED

Initial focused RED run: 6 failed files out of 6; 7 failed and 5 passed tests out of 12; exit 1. Failures showed the missing lifecycle, resolver, selector, page wiring, safe-overflow check, and cookie-token guard.

### GREEN

Clean-environment focused run: 11 passed files out of 11; 78 passed tests out of 78; 0 failed; exit 0.

Clean-environment full `tsc --noEmit`: 0 errors; exit 0.

### Browser smoke

Live Next.js and SQLite smoke at `http://127.0.0.1:3129/a/abcdefghijklmnopqrstuvwx` verified:

- One linked identity rendered `Returning as Avery Linked`, auto-stored Avery's UUID, and rendered no selector.
- Two linked identities rendered only `Choose a participant`, `Avery Linked`, and `Blair Linked`, in link-independent participant creation order. The public but unlinked `Public Only` participant did not appear in selector options.
- A stored unlinked UUID was rejected, removed from local storage, and left the selector unchosen.
- An expired session returned HTTP 200 with no saved identity or selector and no browser console or page errors.
- Across all reads, the cookie value and browser expiry stayed unchanged, `HttpOnly=true`, `SameSite=Lax`, `Secure=false` for HTTP, and `document.cookie` stayed empty.
- Live database reads kept `created_at` and `last_seen_at` unchanged. The overflow and fixed-expiry boundaries also passed focused tests.

The browser and dev server were stopped, and the smoke database files were removed.

## Concerns

None. Read-only expired-session resolution intentionally leaves the HttpOnly cookie unchanged; a later guest route response can clear it under the wider route lifecycle contract.

## Independent review fix round 1

Addressed all four findings:

- Guest writes now remove the canonical presented session when its row is expired before inserting the replacement. The same immediate transaction cascades old access rows, and a forced late failure proves rollback restores both rows. Read-only resolution still performs no deletion or timestamp write.
- Authenticated manager and linked-user state now resolves before the device-access guard. A matching pending co-organizer binds and receives a user-linked participant even when the browser already has guest access, without requesting a token or adding a guest session, cookie result, or access row.
- The public-page boundary test proves the resolver receives the raw cookie server-side while rendered output and serialized client props exclude both the raw value and token-digester data.
- Join now has direct safe-integer expiry-overflow coverage for the exact generic `INTERNAL_ERROR`, with no participant/session/access/revision/event persistence.

Review RED: 2 failed files and 1 passed file out of 3; 3 failed and 31 passed tests out of 34; exit 1.

Review GREEN clean-environment focused run: 11 passed files out of 11; 83 passed tests out of 83; exit 0.

Review full clean-environment `tsc --noEmit`: 0 errors; exit 0. All review checks used Node 24.13.0.
