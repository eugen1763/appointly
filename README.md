# Appointly

Self-hosted group scheduling. Put the possible times on one board, watch the answers land live, and
lock the winner. Guests answer from a link — no account, no thread.

An organizer creates an appointment carrying a handful of candidate times, either after signing in
with Google or directly on a trusted internal instance. Everyone else opens one public link, gives
their name, and marks each option Yes or No. Answers appear for everyone in real time. When a winner
is clear, the organizer finalizes it.

---

## Requirements

- **Node 24.x** (`.nvmrc` pins it)
- A **Google OAuth client** when Google login is enabled; guests never need an account
- Nothing else. Storage is a local **SQLite** file.

## Quick start

```bash
npm ci
cp .env.example .env      # then fill in the values below
npm run db:migrate
npm run dev               # http://localhost:3000
```

### Configuration

Every variable in `.env` is required except Google credentials when login is disabled.

| Variable | What it is |
|---|---|
| `APP_URL` | The origin this instance is served from. Used for OAuth callbacks, the public links it hands out, and an exact origin check on every mutating request. |
| `BETTER_AUTH_SECRET` | Signing secret for organizer sessions. |
| `GUEST_TOKEN_SECRET` | Signing secret for guest edit links. Rotating it invalidates every outstanding guest link. |
| `GOOGLE_AUTH_ENABLED` | Set `false` for a shared internal/development instance where anyone can create and manage appointments without signing in. Defaults to `true`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From your Google OAuth client. Required only when `GOOGLE_AUTH_ENABLED=true`. |
| `DATABASE_PATH` | Where the SQLite file lives. Defaults to `./data/appointly.sqlite`. |
| `TRUST_PROXY` | Set `true` only when running behind a reverse proxy that sets `X-Forwarded-*`. Default `false`. |

Generate each secret with:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

The Google OAuth callback is `${APP_URL}/api/auth/callback/google`.

With `GOOGLE_AUTH_ENABLED=false`, every visitor uses one shared internal organizer identity. This is
intended only for trusted internal networks and local development: anyone who can reach the instance
can see the dashboard and manage every appointment owned by that shared identity.

---

## How it works

**Appointments have a type, fixed at creation.** An appointment is a set of whole days, days at a
time, one run of days, or a run with times — and every option in it shares that shape. The composer
infers the type from what you enter rather than asking up front, and names it back to you in plain
words so the inference is never silent.

**Anyone with the link can answer.** A guest gives a display name, gets a participant record and a
private edit link, and can return later to change their answers. The link is shown once; an organizer
can reissue it if someone loses theirs.

**Organizers and co-organizers.** The creator owns the appointment. Co-organizers are invited by email
and gain manager rights when they first sign in with that address. Owners alone can delete the appointment
or manage the co-organizer list.

**Live updates** ride a Server-Sent Events stream carrying only a revision number; the client
re-fetches a snapshot when it sees one it hasn't rendered. Responses save optimistically per option
and roll back if the server disagrees.

**Limits:** 1–100 options per appointment (default 10), 200 participants, 20 co-organizers, 120
characters of title, 2,000 of description, 80 of display name.

### Routes

| Route | |
|---|---|
| `/` | Landing; signing in starts Google OAuth directly |
| `/dashboard` | Your appointments, with tallies and the leading option, plus the composer |
| `/appointments/new` | The same composer, full page |
| `/a/[publicId]` | The board — answering, results, editing, finalizing |
| `/a/[publicId]/edit#…` | Redeems a guest's private edit link, then redirects to the board |
| `/api/health` | `{"status":"ok"}` |

---

## Architecture

Next.js App Router with React Server Components; client components only where interaction demands it.
CSS modules over a token system in `src/app/globals.css` — every colour flows through a custom
property, which is what makes the light and dark themes a single set of value definitions.

```
src/
  app/                     routes, API handlers, and route-scoped components
    a/[publicId]/          the appointment board and everything on it
    api/appointments/      the HTTP surface
    _components/           shared shell pieces
  features/appointments/
    contracts.ts           Zod schemas + the route contract table — one source of truth
                           for every request, response and error shape
    server/                services: the only place that touches the database
  db/                      drizzle schema and connection
  lib/                     auth, email normalisation, return-path safety
e2e/                       Playwright specs
drizzle/                   SQL migrations
```

Two conventions are worth knowing before adding code:

- **`contracts.ts` is authoritative.** Routes parse their input and validate their output against it,
  and the e2e suite parses snapshots with the same schemas. Change the contract, not the handler.
- **Route handlers are factories.** Each `route.ts` wires a handler built in `route-handler.ts` with
  its dependencies injected, so the handler can be unit-tested without a server.

### Storage

SQLite via better-sqlite3, in WAL mode. That means **a single app instance on local disk** — not two
replicas, and not a network filesystem. Options are stored either as calendar dates or as UTC
instants depending on the appointment type, with a canonical key enforcing uniqueness within an
appointment.

---

## Testing

```bash
npm run typecheck
npm test           # unit — vitest
npm run test:e2e   # end-to-end — Playwright, spins up its own dev server
```

Roughly 1,150 unit tests and 22 end-to-end tests. The e2e suite runs serially against a throwaway
database (`.tmp/e2e.sqlite`, reset by `pretest:e2e`) with `E2E_AUTH=1`, which enables an
email/password branch so fixtures can sign in without Google. That branch requires **both**
`E2E_AUTH=1` and a non-production `NODE_ENV`, so it cannot be switched on in a production build.

A single spec, for iteration:

```bash
node scripts/reset-e2e-db.mjs && npx playwright test e2e/boundaries.spec.ts
```

Accessibility is gated, not assumed: `e2e/route-a11y.spec.ts` runs axe across every surface in both
colour schemes at desktop and mobile widths, and `e2e/board-a11y.spec.ts` asserts Chrome's **platform**
accessibility tree — because `getByRole` computes roles from the DOM, and has been observed passing on
markup a screen reader could no longer navigate.

> **Known quirk:** `npm test` exits non-zero even when every test passes. Vitest also collects the
> Playwright specs, which it cannot run, producing one file-level error per spec file. Read the test
> count, not the exit code.

---

## Deployment

```bash
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

The image is a multi-stage build producing a Next.js standalone server; only build output reaches the
runtime stage. The database lives in the `appointly-data` volume, and a healthcheck polls
`/api/health`.

Two things to know before building:

- **The build needs network access to `fonts.googleapis.com`.** Archivo and IBM Plex Mono are fetched
  at build time and self-hosted into the image, so nothing is requested from a third party at runtime —
  but under Turbopack a font fetch failure is fatal with no retry. For an air-gapped build, vendor the
  woff2 files under `src/app/fonts/` and switch `src/app/layout.tsx` to `next/font/local` with the same
  variable names; no other file needs to change.
- **Back up the database file, not just the volume.** It runs in WAL mode, so copying
  `appointly.sqlite` alone can capture almost nothing — the data may still be in the write-ahead log.
  Use `sqlite3 <db> ".backup <target>"`.

Migrations are plain SQL under `drizzle/`; `npm run db:generate` writes a new one from the schema and
`npm run db:migrate` applies it.

---

## Notes

`OPEN-POINTS.md` records what is unfinished, what was deliberately left undone and why, and two traps
worth knowing before doing responsive or accessibility work here.
