# Task 42: Run install, typecheck, unit, and build checks

Verify the complete Appointly implementation from the repository root with Node.js 24.13.0.

## Commands

Run in this exact order:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`

Use the pinned lockfile and Node.js 24.13.0. Supply fixed valid non-production values for `APP_URL`, `BETTER_AUTH_SECRET`, `GUEST_TOKEN_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_PATH`, and `TRUST_PROXY` to any command that loads runtime modules.

## Acceptance

- `npm ci` exits zero from a clean lockfile install.
- TypeScript reports zero errors.
- Vitest reports zero failed files and zero failed tests.
- The Next.js production build exits zero.
- Do not change source code unless a command exposes a real defect. If a defect appears, follow systematic debugging, add or update only behavior-level coverage when required, review the fix, and rerun the failed command before continuing.
- Write `.superpowers/sdd/appointly-mvp-plan/task-42-report.md` with exact command outcomes, counts, and any fix evidence.
- Commit nothing until every command passes and the coordinator records the result.
