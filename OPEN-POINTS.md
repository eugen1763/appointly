# Open points

State at the end of the frontend redesign, 2026-08-04. Everything below is either unfinished,
deliberately not done, or a thing worth knowing before touching the relevant area.

Current gates: typecheck clean, **1152 unit tests**, **22 e2e tests**, all passing.
Deployed to production twice today; the running image is built from `58b28b2`.

---

## Unfinished

### 1. Phase 6 step 7 — the final gate was never run

Steps 1–6 of the polish phase are committed and green, but the closing gate was not executed:

- the timing-race specs (`board-a11y`, and anything hydration-sensitive) run **three times on each of
  Chromium, Firefox and WebKit** — a single green run of that class is not evidence, because it fails
  on a race and so passes and fails against identical code
- the populated-state screenshot audit at 320 and 1280 in both schemes

Nothing suggests a problem — the full suite passes, including the axe gate on all six surfaces — but
the phase is not formally closed until those run.

### 2. Deploy the polish phase

Commits `6c22bbb`…`b533b3c` are unreleased. They contain two things that are not cosmetic:

- **a functional dead end**: a board with zero options never rendered the add control, so an organizer
  who deleted every option could not add one back (`ebff3db`)
- **a contrast failure**: `--color-text-faint` was 3.60:1 in light mode, below AA. Now 4.68–5.14:1
  light and 5.13–6.13:1 dark (`2d3ead7`)

---

## Deliberately not done

### 3. Two timed options on the same day, or several disjoint ranges, in one creation

The composer is day-keyed, so it cannot express "Monday 09:00 or Monday 14:00" in a single creation —
the old wizard could, because it took each candidate independently. Adding a second mechanism on top
of the per-day time overrides would cost the primary path its simplicity. The board's inline ＋ adds
an option in two interactions, which covers it.

The e2e helper throws a descriptive error for these shapes rather than silently producing the wrong
appointment type, so the limit stays loud.

### 4. `GuestIdentitySelector` and `ResponseControl` remain controlled inputs

Both are server-rendered with controlled React values, so a pre-hydration interaction is ignored.
Unlike the three forms fixed in `04032b7` and `58b28b2`, **neither loses data**: no request is sent and
React's next render visibly snaps the control back, so the user sees that nothing happened and repeats
it. Converting them carries real regression risk — `ResponseControl`'s radio semantics are bound by
nine e2e specs — for no data-safety gain.

### 5. The chosen option on finalized dashboard cards

Would need another server query, and the polish phase was scoped to presentation and semantics only.

### 6. Guest-link reset lists every participant

The server accepts a reset for any participant, and the snapshot carries no field distinguishing
manager-linked ones, so the UI cannot filter them out without a server change. Guarded with a two-step
inline confirm instead.

---

## Worth knowing

### 7. `npm test` reports 16 failed *files* while every test passes

Vitest collects the `e2e/*.spec.ts` Playwright specs, which it cannot run — one collection error per
spec file. Pre-existing, unrelated to the redesign, and cosmetic; it makes `npm test` exit non-zero.
Fixable with an `include`/`exclude` in a vitest config. The test count is the signal: **1152 passed**.

### 8. The production build now needs font-CDN egress

`next/font/google` fetches Archivo and IBM Plex Mono at build time and self-hosts them into the image,
so nothing is requested from a third party at runtime. But `npm run build` now needs
`fonts.googleapis.com` in addition to the npm registry, and under Turbopack a font fetch failure is
**fatal with no retry and no timeout**. If an air-gapped build is ever needed: vendor the woff2 files
under `src/app/fonts/` and switch `layout.tsx` to `next/font/local` with the same `variable` names —
no other file changes, because everything flows through `--font-archivo` and `--font-plex-mono`.

### 9. WebKit does not wrap around the last radio

Arrow keys move between the Yes / No / Unanswered radios in every engine, but WebKit does not wrap from
the last one — and `Unanswered` is last in DOM order, so `ArrowRight` from it does nothing there.
Native, pre-existing, identical before and after the redesign. `board-a11y.spec.ts` uses Space on
WebKit and asserts the arrow path strictly on Chromium and Firefox.

### 10. `board-a11y.spec.ts` seeds through the API, not the composer

That was originally load-bearing — the composer's pre-hydration bug made creation fail under WebKit.
It is belt-and-braces since `58b28b2`, but leaving it alone keeps an engine gate for the board from
depending on the creation surface.

### 11. Two traps that the automated gates cannot see

Both cost real defects during this work; treat them as standing rules.

- **Automated overflow probes are blind to native date/time inputs.** Chromium compresses their
  shadow DOM instead of overflowing, so `scrollWidth > clientWidth` never fires even when the value is
  visibly truncated. Only a rendered image catches it.
- **Screenshot populated states, not empty ones.** Every defect that escaped the gates in this project
  was found by looking at a state that had content in it — a board with answers, a chip carrying its
  own time, a co-organizer list with entries. The empty surface passes while the populated one is
  broken.

### 12. `.editGlyph` shows as an axe *incomplete*, not a violation

"Element content contains only non-text characters" on the ✎ pencil. The span is `aria-hidden="true"`
and the control carries its own accessible name; axe simply cannot compute contrast for non-text
content. Not a defect — recorded so nobody chases it.

---

## Reference

- Full plan, decisions and measurements: `/root/.claude/plans/ancient-napping-harbor.md`
- Variant study with all five prototypes and their measured click and scroll counts:
  https://claude.ai/code/artifact/58465c94-f764-4160-a419-c88415368787
- Database backups from both deploys: `/opt/appointly-backups/`
- Rollback: `git revert <sha>` then
  `docker compose -f compose.yaml -f compose.production.yaml up -d --build`. No schema changed at any
  point, so the database is untouched either way. **Never `git clean -xfd`** — `.env` is untracked and
  holds the live auth, guest-token and Google OAuth secrets.
