# Task 56: Verify Docker Compose health production app

## Scope

Run the approved container verification against the checked-in `Dockerfile`, `compose.yaml`, startup migration hook, and public health route. Do not change production or configuration files unless a verified defect blocks the required behavior.

## Environment

Provide temporary local values only through the command environment:

- `APP_URL=http://localhost:3000`
- non-empty placeholder `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- distinct 32-byte-or-longer `BETTER_AUTH_SECRET` and `GUEST_TOKEN_SECRET`
- `TRUST_PROXY=false`

The Compose service must retain `DATABASE_PATH=/app/data/appointly.sqlite` from `compose.yaml` and use the named `appointly-data` volume.

## Verification contract

1. Run `docker compose config` with the required environment and require exit zero. Inspect the resolved app environment, port, health check, build context, and named volume.
2. Run `docker compose up --build -d` and require exit zero.
3. Wait only through Docker's health status. Require `docker compose ps` to report the `app` service as `healthy`.
4. From the host, use Node 24 built-in `fetch` against `http://127.0.0.1:3000/api/health`. Require HTTP 200, exact body `{"status":"ok"}`, `Content-Type: application/json`, and `Cache-Control: no-store`.
5. Inspect the running service configuration. Prove one app container, the expected production command and image, the named SQLite volume mounted at `/app/data`, and no second app replica.
6. Record commands, exit results, resolved configuration facts, health facts, and any defects in `.superpowers/sdd/appointly-mvp-plan/task-56-report.md`.
7. Leave the healthy Compose service running for Task 57 Google OAuth and persistence verification. Do not delete the named volume.

Do not run unrelated tests, formatters, linters, Playwright, or commits during verification.