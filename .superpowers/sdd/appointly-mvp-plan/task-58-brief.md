# Task 58: Run final manual date-time-range flow

## Scope

Drive one complete browser flow against the real Appointly UI. Use the local E2E authentication fixture only for the organizer because Task 57 separately reserves real Google OAuth validation. Do not use direct appointment or mutation APIs, fixed public IDs, database access, or test-only DOM actions.

## Manual flow contract

1. Start the application with a fresh E2E SQLite database and the existing authenticated owner browser state.
2. In the organizer browser, create one `DATE_TIME_RANGE` appointment with two distinct future ranges in one IANA time zone. Record the generated public link.
3. Open that link in a fresh anonymous browser context. Join with a new guest name and record the private edit link shown once.
4. Answer one original option Yes and the other No. Suggest a third date-time range through the public UI.
5. Confirm the already-open organizer page receives the guest, both responses, and the third range without a page reload.
6. Open the private edit link in a second fresh device context. Confirm the same guest identity and responses. Change one response.
7. In the organizer context, add an owner Yes response to the guest-created option. Confirm the already-open guest context receives that response without a page reload.
8. In the second guest context, request deletion of the guest-created option. Confirm the dialog lists the owner as a current Yes participant before deletion. Cancel the deletion to preserve the graph for finalization.
9. In the organizer context, finalize one original option. Confirm the guest page becomes read-only and highlights that exact final option.
10. Reopen through the organizer UI. Confirm guest response and suggestion controls return without a page reload.
11. Record generated identities, chosen ranges and zone, live-update observations, deletion-dialog participant proof, finalization/reopen proof, and console/network errors in `.superpowers/sdd/appointly-mvp-plan/task-58-report.md`.
12. Close every browser context and stop the local server during final cleanup.

Use visible and accessible controls for every mutation. Browser evaluation may inspect state but must not trigger actions.