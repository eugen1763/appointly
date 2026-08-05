# Open points

Current limitations and maintenance notes for Appointly. This document intentionally avoids
deployment-specific state: the public repository cannot verify which commit a private installation
is running, where its backups live, or how its host is configured.

Last reviewed: **2026-08-05**

## Verified baseline

The following checks were run against `main` during the last review:

```bash
npm run typecheck
npx vitest run --exclude 'e2e/**'
npx playwright test --list
```

- TypeScript: clean
- Unit tests: **1,161 passed across 96 files**
- Playwright inventory: **22 tests across 16 files**

> [!NOTE]
> Listing the Playwright suite verifies its inventory, not browser execution. Run
> `npm run test:e2e` against the required browser set before a release.

## Pending verification

### Repeat the cross-browser timing gate

The accessibility and hydration-sensitive browser checks should be repeated **three times in
Chromium, Firefox, and WebKit** before treating a release as fully cross-browser verified. These
checks can expose timing races that a single green run does not rule out.

The current `playwright.config.ts` has no named browser projects, so this matrix is not produced by
the default command. Configure or invoke the required browser projects explicitly rather than
assuming that `npm run test:e2e` covered all three engines.

### Audit populated screenshots at narrow and wide viewports

Capture populated states at **320 px** and **1280 px**, in both light and dark color schemes. Empty
screens are insufficient: the regressions that previously escaped automated checks appeared only
after the interface contained answers, time chips, or co-organizer rows.

## Product limitations

### The composer cannot create two timed options on the same day

The creation UI is keyed by calendar day. It cannot represent “Monday at 09:00 or Monday at 14:00”
in one creation flow, nor can it create several disjoint ranges at once. The board's inline
**Add an option** control can add the extra option after creation.

The E2E creation helper rejects unsupported shapes rather than silently creating a different
appointment type.

### Two controls ignore interaction before hydration

`GuestIdentitySelector` and `ResponseControl` render as controlled React inputs. An interaction that
happens before hydration is ignored and the next render restores the controlled value.

Unlike a text-entry hydration race, this does not lose submitted data: no request is sent and the
control visibly returns to its previous state. Changing this behavior would need careful
cross-browser radio semantics and accessibility regression coverage.

### Finalized dashboard cards show the leader, not the chosen option

Dashboard cards display the leading option calculated from responses. A finalized card does not
separately query and label the appointment's selected final option. Adding that distinction requires
extending the dashboard query and its public result type.

### Guest-link reset lists every participant

The management panel offers reset-link controls for every participant. The appointment snapshot does
not distinguish guest-only participants from manager-linked participants, so the UI cannot filter
the list without a server contract change. Reset remains guarded by a two-step inline confirmation.

## Tooling and build notes

### Use an explicit Vitest exclusion for unit-only runs

`npm test` invokes `vitest run`, which also discovers the 16 Playwright specification files under
`e2e/`. Vitest cannot execute those files and exits non-zero with collection errors even when every
unit test passes.

Use this command for a clean unit-only run:

```bash
npx vitest run --exclude 'e2e/**'
```

A future cleanup can encode that exclusion in the default Vitest configuration or package script.

### Production builds need Google Fonts egress

`next/font/google` fetches Archivo and IBM Plex Mono during `npm run build`, then self-hosts the font
files in the output. No font request is made to Google at runtime, but the build needs access to
`fonts.googleapis.com` and its font assets.

For an air-gapped build, vendor the WOFF2 files under `src/app/fonts/` and switch
`src/app/layout.tsx` to `next/font/local`, preserving the `--font-archivo` and `--font-plex-mono`
variables used by the CSS token system.

### SQLite deployment remains single-instance

The database runs in WAL mode and must live on local disk. Do not run multiple application replicas
against the same file or place it on a network filesystem.

Back up through SQLite so committed data still in the write-ahead log is included:

```bash
sqlite3 /path/to/appointly.sqlite ".backup /path/to/backup.sqlite"
```

## Browser and accessibility notes

### WebKit does not wrap from the last response radio

Arrow keys move between the Yes, No, and Unanswered radios in all tested engines, but Playwright's
WebKit build does not wrap from the last radio back to the first. `e2e/board-a11y.spec.ts` therefore
uses Space for that WebKit path while keeping arrow-key assertions for Chromium and Firefox.

This is native radio-group behavior rather than an Appointly-specific keyboard handler.

### The board accessibility spec seeds through the API

`e2e/board-a11y.spec.ts` creates its appointment through the same-origin API instead of driving the
composer. This keeps a cross-engine board gate independent from the creation surface and makes a
failure easier to attribute.

### Overflow probes cannot replace visual review

Chromium may compress the shadow DOM of native date and time controls rather than report horizontal
overflow. A `scrollWidth > clientWidth` check can therefore pass while a visible value is truncated.
Keep rendered-image review in the release checklist, especially for populated states.

### The edit glyph can produce an axe “incomplete” result

The decorative pencil glyph (`.editGlyph`) is `aria-hidden`, while its button has a textual accessible
name. Axe may report “Element content contains only non-text characters” as **incomplete** because it
cannot calculate contrast for that glyph. This is not an accessibility violation by itself; verify
that the surrounding control retains its accessible name and visible focus treatment.

## Keeping this file current

- Record only facts that are reproducible from the repository.
- Put installation-specific deploy and backup details in that installation's private runbook.
- Re-run the baseline commands before changing test counts.
- Remove resolved points instead of preserving a chronological implementation diary.
