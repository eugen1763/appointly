# Task 39 Report

## Status

DONE

## Implementation

- Added idempotent manager reopen behavior for finalized appointments, with one revision update and post-commit publication only when state changes.
- Added owner-only exact-title appointment deletion with stable disclosure, authorization, validation, cascade deletion, tombstone publication, and empty `204` routing.
- Added the reopen route and the root appointment `DELETE` route through production service wiring.
- Added manager-only reopen and deletion controls with request locks, stable route errors, complete snapshot refresh after reopen, exact title confirmation, dialog focus handling, 44px targets, and 320px layout support.
- Preserved every valid title character in deletion confirmation through a textarea.
- Cleared only the deleted appointment's participant key before navigation.
- Invalidated pending participant and SSE snapshot refreshes after deletion, so stale route-transition work cannot restore the cleared key.
- Added focused service, route, client, storage-race, multiline-title, cascade, rollback, and authorization coverage.

## Verification

- Focused lifecycle suite: 89/89 passed before review fixes.
- Final client and identity suite: 58/58 passed.
- Full TypeScript diagnostics passed after all fixes.
- A live 320px Chromium smoke reopened a finalized appointment, restored response controls, deleted it after exact confirmation, navigated to `/`, preserved an unrelated storage key, and showed no horizontal overflow.
- The final live deletion smoke confirmed the appointment, manager, participant, option, and response row counts were all zero.
- Task review: clean after two fix rounds; no Critical or Important findings remain.

