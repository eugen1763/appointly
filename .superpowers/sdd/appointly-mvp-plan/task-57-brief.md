# Task 57: Verify Google OAuth and persistence manually

## Prerequisites

- Task 56 leaves the production Compose `app` service healthy on `http://localhost:3000`.
- A real Google Web application OAuth client registers `http://localhost:3000/api/auth/callback/google`.
- The Compose environment contains the real `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, distinct strong `BETTER_AUTH_SECRET` and `GUEST_TOKEN_SECRET`, `APP_URL=http://localhost:3000`, `DATABASE_PATH=/app/data/appointly.sqlite`, and `TRUST_PROXY=false`.
- A human-controlled Google test account can complete the consent flow. Do not record account credentials or OAuth secrets in repository files or command output.

## Manual verification contract

1. Open `http://localhost:3000` in a clean browser context.
2. Choose `Continue with Google`. Complete Google's real OAuth consent flow and require a successful return to the authenticated Appointly dashboard.
3. Create one appointment through the UI. Record its generated public link and add at least one guest response through an anonymous browser context.
4. Sign out of the organizer session. Open the public link in a fresh anonymous context and confirm it remains usable without authentication and retains the appointment and response.
5. Run `docker compose restart app`. Wait for Docker to report the `app` service as healthy.
6. Reopen the same public link. Confirm the exact appointment and response persist from the named `appointly-data` SQLite volume.
7. Sign in again through Google. Confirm the organizer dashboard still lists the appointment and opens its owner view.
8. Record only non-secret browser outcomes, generated object identities, health status, restart result, and persistence proof in `.superpowers/sdd/appointly-mvp-plan/task-57-report.md`.

Do not replace the real Google OAuth flow with `E2E_AUTH`, a direct API, a mocked provider, or an email/password fixture.