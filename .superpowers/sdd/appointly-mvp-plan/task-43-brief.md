# Task 43: Configure Playwright fixtures and authentication

Add the shared one-database, two-authenticated-user Playwright foundation for Tasks 44–55.

## Configuration contract

- Add `playwright.config.ts` with `testDir: "./e2e"`, `fullyParallel: false`, and exactly one worker.
- Configure one web server with command `npm run dev -- --hostname 127.0.0.1 --port 3000`, health URL `http://127.0.0.1:3000/api/health`, `reuseExistingServer: false`, and a bounded startup timeout.
- Give only the Playwright development server these exact environment values:
  - `NODE_ENV=development`
  - `E2E_AUTH=1`
  - `DATABASE_PATH=.tmp/e2e.sqlite`
  - `APP_URL=http://127.0.0.1:3000`
  - `BETTER_AUTH_SECRET=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8`
  - `GUEST_TOKEN_SECRET=ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8`
  - `GOOGLE_CLIENT_ID=appointly-e2e-google-client`
  - `GOOGLE_CLIENT_SECRET=appointly-e2e-google-secret`
  - `TRUST_PROXY=false`
- Set the shared Playwright `baseURL` to `http://127.0.0.1:3000`.
- Keep the existing `pretest:e2e` reset script. It deletes only `.tmp/e2e.sqlite`, `.tmp/e2e.sqlite-wal`, and `.tmp/e2e.sqlite-shm` before the server starts.

## Global setup and fixture contract

- Add a global setup module that uses Playwright's `request.newContext`; do not hand-sign cookies.
- Wait for `GET /api/health` to return `200` with exact JSON `{ "status": "ok" }` before fixture creation.
- Create one owner and one co-organizer through Better Auth's normal `POST /api/auth/sign-up/email` endpoint, each in a separate request context.
- Require a successful setup response and a `better-auth.session_token` cookie for each user.
- Save separate Playwright storage-state files under `.tmp`.
- Export fixed owner/co-organizer identity data and reusable fixtures that create independent authenticated browser contexts/pages from those storage states. Future tests must also retain Playwright's normal anonymous `page` fixture.
- Close every request/browser context in cleanup paths.
- Use stable accessible names and no workstation-specific browser executable path.

## Production safety

- Keep password authentication disabled when `NODE_ENV=production`, even if `E2E_AUTH=1`. The existing `src/lib/auth-config.test.ts` production case already proves this and must remain.
- Do not add a login route.
- Do not document `E2E_AUTH` in `.env.example`.
- Do not pass `E2E_AUTH` to the Docker image or Compose runtime.

## Acceptance

- The existing failing `playwright-config.test.ts` passes and proves the exact one-worker server/environment contract.
- A focused global-setup/fixture browser smoke starts the development server, waits for health, creates both users through Better Auth, loads both storage states, and shows each expected signed-in identity.
- The setup endpoint assertion fails clearly for any non-2xx response, malformed user response, missing session cookie, or wrong health JSON.
- The global setup is safe after the reset script and does not reuse one user's cookie context for the other.
- Focused TypeScript and authentication configuration tests pass.
- Write `.superpowers/sdd/appointly-mvp-plan/task-43-report.md` with files, contracts, and coordinator validation.
- Skip formatter, linter, build, project-wide tests, and commits. The coordinator validates and commits.
