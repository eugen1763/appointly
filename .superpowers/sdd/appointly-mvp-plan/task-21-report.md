# Task 21 report

Date: 2026-08-03

## Scope completed

- Added a display-safe dashboard appointment query to the appointment management service.
- Kept pending invitation binding as an explicit command that the dashboard runs before its query.
- Added safe app-local return-path handling and one server organizer access helper.
- Added the public landing page, Google sign-in page and client action, protected dashboard, and protected creation entry route.
- Added the warm ruled-ledger styling, compact Yes / No / Unanswered strip, responsive rules, visible focus, reduced-motion handling, and 44px minimum actions.
- Enabled Next.js's TypeScript CLI mode, which the pinned Next.js 16.2.12 and TypeScript 7.0.2 combination requires.
- Did not add the Task 22 form, fake submission behavior, later manager commands, Playwright setup, or appointment mutation controls.

## RED

### Dashboard service

Command:

```text
npm test -- src/features/appointments/server/dashboard.test.ts
```

Before `listDashboardAppointments` existed, the live SQLite suite ran 5 tests and all 5 failed with `TypeError: listDashboardAppointments is not a function`. The cases covered:

1. pending invitation binding before the list;
2. owner and co-organizer records with display-safe fields;
3. duplicate prevention for an owned appointment with several managers;
4. exclusion of private and still-pending appointments;
5. `updatedAt DESC`, then `publicId ASC` ordering.

### Return-path helper

A compiling skeleton returned only its fallback. Under Node 24.13.0, the suite ran 9 tests: 2 failed and 7 passed. The failures proved that a valid local path was not kept and that the sign-in URL did not encode its return path. The passing cases already rejected absolute, protocol-relative, backslash, relative, script-scheme, empty, and multi-value inputs.

### Google sign-in client

The first test load exposed that this repository does not install the optional `@testing-library/dom` peer. The test was changed to use React `createRoot` / `act` with jsdom and no dependency change. Against a button-only client skeleton, all 3 component tests then failed:

1. Better Auth Google social sign-in was not called;
2. a thrown start failure did not show the retry message;
3. a Better Auth error result did not show the retry message.

## GREEN

- Implemented `listDashboardAppointments(context, { userId })` with only `publicId`, `title`, `type`, `status`, `updatedAt`, and role in its result. It gives ownership precedence, removes duplicate public IDs, excludes unbound rows, and sorts newest first with a public-ID tie break.
- Implemented strict local return-path parsing and encoded sign-in redirect paths.
- Implemented a synchronous client component that calls `authClient.signIn.social({ provider: "google", callbackURL })`, names the pending state, handles thrown and returned failures, and restores the same action for retry.
- Final focused Node 24.13.0 run: 3 files passed, 17 tests passed, 0 failed.
  - dashboard service: 5 passed;
  - return paths: 9 passed;
  - sign-in client: 3 passed.

## Verification

### TypeScript

Command used the exact Node 24.13.0 runtime:

```text
node node_modules/typescript/bin/tsc --noEmit
```

Result: exit 0, 0 type errors.

### Browser smoke

The Next.js development server ran under Node 24.13.0 after enabling `experimental.useTypeScriptCli`.

- `/` rendered at 320x800 and 1280x800 with no horizontal overflow.
- The landing accessibility tree exposed named links and a logical H1 / H2 order with header, primary nav, main, and sections.
- Every measured landing action was at least 44px high at both widths.
- `/sign-in` rendered at 320px with a named 44px Google button, no horizontal overflow, and a visible 3px solid keyboard focus ring.
- An unsafe absolute `returnTo` value rendered the sign-in page with the dashboard fallback rather than an external callback.
- Anonymous `/dashboard` redirected to `/sign-in?returnTo=%2Fdashboard`.
- Anonymous `/appointments/new` redirected to `/sign-in?returnTo=%2Fappointments%2Fnew`.

## Concerns and intentional limits

- Async Server Components were not unit-rendered. The task bars that pattern and reserves their full authenticated coverage for Playwright.
- Playwright, formatters, linters, builds, and project-wide suites were not run, as requested.
- The authenticated dashboard rendering branch was covered at the live SQLite service boundary and by TypeScript, while this task's browser smoke covered the required anonymous server redirects. A later Playwright task owns the signed-in end-to-end route flow.
- The creation entry names Details, Options, and Share and states that nothing is saved there. The real three-step form remains Task 22 work.

## Review fix round 1

The dashboard appointment title link was initially an inline element with a
27px browser hit area. The link now uses `inline-flex`, keeps its existing 20px
heading size, centers the same text, and has the shared 44px minimum target
height.

Browser RED / GREEN evidence against a signed-in dashboard with a real
appointment:

- RED: height 27px, `display: inline`, `min-height: 0px`.
- GREEN: height 44px, `display: inline-flex`, `min-height: 44px`.
- The heading font size remained 20px.

Post-fix verification under Node 24.13.0:

- focused tests: 3 files passed, 17 tests passed, 0 failed;
- full `tsc --noEmit`: exit 0, 0 type errors.

## Review fix round 2

A one-character valid title exposed the remaining horizontal target gap. The
title link now uses the shared 44px minimum width and horizontal centering in
addition to its 44px minimum height.

Browser RED / GREEN evidence:

- RED at 320px and 1280px: 14x44px, `min-width: 0px`.
- GREEN at 320px and 1280px: 44x44px, `min-width: 44px`.
- The text center differed from the target center by 0px at both widths.
- The heading stayed 20px with normal white-space.
- A 111-character spaced title wrapped to its 288px parent at 320px rather
  than overflowing.

Post-fix verification under Node 24.13.0:

- focused tests: 3 files passed, 17 tests passed, 0 failed;
- full `tsc --noEmit`: exit 0, 0 type errors.