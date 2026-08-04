# Task 27 report

## Status

Complete. The unlisted public appointment route reads live SQLite data without authentication, returns the app not-found result for an unknown public ID, and renders one stable ordered data set as a desktop ledger or mobile option cards.

## Public data boundary

`getPublicAppointment` returns only:

- appointment public ID, title, description, type, status, option limit, final option ID, and revision;
- participant ID and full display name;
- option ID and the type-specific date or timed value;
- each saved response's participant ID and `YES` or `NO` value.

The projection omits owner and manager identity, user IDs, manager emails, option creator identity, token digests, guest sessions, private links, and rate-limit data. Participants sort by `createdAt`, then ID. Options sort by their type-specific start, then `createdAt`, then ID. Each option's response list follows the same participant order.

## Interface

- `src/app/a/[publicId]/page.tsx` exports `noindex` and `nofollow` metadata, forces a dynamic Node route, needs no session, and calls `notFound()` for a missing appointment.
- The desktop view uses a semantic table with sticky participant and option headers, text response states, totals, selected structure, and internal horizontal scrolling.
- The mobile view uses an ordered option-card list with the same option and participant arrays, text totals, full names, response lists, and selected structure.
- Timed labels render neutral `Local time` text on the server and first client pass. An effect then formats the value with the browser's `Intl.DateTimeFormat` locale and resolved time zone and shows the IANA zone label. This avoids server-zone hydration text.
- Date-only labels parse `YYYY-MM-DD` calendar fields and use fixed month names. They never construct a `Date` or UTC instant.

## RED-GREEN evidence

Node version for the recorded RED, GREEN, and TypeScript runs: `v24.13.0`.

- RED: 3 of 3 focused test files failed. Seven collected query tests failed because `getPublicAppointment` did not exist, and the two render/route suites failed to import their missing production modules. Exit 1.
- GREEN: 3 of 3 focused test files passed; 16 of 16 tests passed. Exit 0.
- Final focused command: `node node_modules/vitest/vitest.mjs run src/features/appointments/server/snapshot.test.ts src/app/a/[publicId]/PublicAppointmentView.test.tsx src/app/a/[publicId]/page.test.tsx` using the Node 24.13.0 binary.
- Full TypeScript: `tsc --noEmit` passed with zero diagnostics. Exit 0.

Tests cover the four option kinds, start/createdAt/ID ordering, participant and response order, exact public projection, unknown IDs, route metadata, public rendering, desktop/mobile structures, all response labels, finalized selection, fixed locale/zone timed formatting, post-mount IANA output, and date-only stability in `Pacific/Honolulu`.

## Browser smoke

The app ran under Node 24.13.0 with valid non-production environment values and a migrated live SQLite appointment at:

`http://127.0.0.1:3000/a/Task27SmokeAppointment01`

The fixture had three `DATE_TIME_RANGE` options, four full participant names, individual saved responses, and one finalized selection.

### 320 × 800

- HTTP route rendered without authentication.
- Document overflow: 0 CSS pixels.
- Mobile option cards visible; desktop ledger hidden.
- Three cards kept exact option order and each card kept exact participant order.
- `Yes`, `No`, and `Unanswered`, `Selected`, and `Europe/Berlin` were visible in text.
- `meta[name=robots]` was `noindex, nofollow`.
- Console errors: 0; page errors: 0; failed requests: 0.
- Screenshot: `/tmp/omp-sshots-15488dc903172694.webp`.

### 1280 × 800

- Document overflow: 0 CSS pixels.
- Desktop ledger visible; mobile cards hidden.
- Four participant rows kept the same participant and option order as mobile.
- All response labels, the selected option, and `Europe/Berlin` were visible.
- The ledger contained horizontal overflow internally: 1088 CSS-pixel client width and 1153 CSS-pixel content width.
- Header and participant name cells both computed to `position: sticky`.
- Console errors: 0; page errors: 0; failed requests: 0.
- Screenshot: `/tmp/omp-sshots-15488dd8a3d72695.webp`.

The server stopped cleanly with exit 0. The temporary seed script and SQLite files were removed.

## Concern

Next dev logged the existing `src/instrumentation.ts` Edge-runtime compatibility warnings about `node:path` and `process.cwd()`. They did not come from this task's route: the public route declared the Node runtime, returned 200 on each smoke request, and the browser recorded no console, page, or request errors.

## Fix round 1: React Server Component boundary

An independent review found that the server-rendered `PublicAppointmentView` called `formatCalendarDate` from `option-label.tsx`, whose top-level `"use client"` directive makes every export a client reference in Next React Server Components. Vitest did not model that boundary, and the first timed-only smoke never reached either date branch.

The pure calendar formatter now lives in server-safe `calendar-date.ts`. The client module exports only timed browser formatting and `TimedOptionLabel`. A focused boundary test replaces the client module's former date export with a throwing reference and server-renders a `DATE` appointment. It fails if the server view calls through that client boundary.

- Boundary RED under Node 24.13.0: 1 test file failed; 1 of 1 tests failed with `Server view invoked an export from a client module`; exit 1.
- Boundary GREEN under Node 24.13.0: 1 test file passed; 1 of 1 tests passed; exit 0.
- Final task-focused run: 4 test files passed; 17 of 17 tests passed; exit 0.
- Full `tsc --noEmit` under Node 24.13.0 passed with zero diagnostics; exit 0.

### Live Next date smoke

The fix ran through Next dev with a new migrated live SQLite database and anonymous browser requests:

- `DATE` at `http://127.0.0.1:3000/a/Task27DateAppointment001`, 320 × 800: HTTP 200; 0 CSS-pixel document overflow; mobile cards visible; `February 29, 2032` and `March 1, 2032` rendered with raw `datetime` values `2032-02-29` and `2032-03-01`; no console errors, page errors, or failed requests. Screenshot: `/tmp/omp-sshots-15488f88488887e6.webp`.
- `DATE_RANGE` at `http://127.0.0.1:3000/a/Task27RangeMeeting000001`, 1280 × 800: HTTP 200; 0 CSS-pixel document overflow; desktop ledger visible; `March 10, 2032 – March 10, 2032` proved the allowed equal-endpoint range and `March 12, 2032 – March 14, 2032` proved a multi-day range; raw calendar values stayed unchanged; no console errors, page errors, or failed requests. Screenshot: `/tmp/omp-sshots-15488f916dc887e7.webp`.
- Timed regression at `http://127.0.0.1:3000/a/Task27TimedMeeting000001`, 1280 × 800: HTTP 200; 0 CSS-pixel document overflow; `Mar 15, 2032, 1:00 PM` and `Europe/Berlin` rendered after mount; no console errors, page errors, or failed requests.

The second smoke server stopped cleanly with exit 0. Its seed script and SQLite files were removed.
