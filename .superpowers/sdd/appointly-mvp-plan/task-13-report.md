# Task 13 report

## Result

Implemented shared participant-name normalization and reusable Unicode code-point length, count, option-limit, and option-capacity predicates. Added a participant display-name length check and a normalized-name nonempty check to the live SQLite schema. No route or service mutation behavior was added.

## Files changed

- `src/features/appointments/validation.ts`
  - Normalizes participant names with NFKC, Unicode outer trim, internal whitespace collapse, and a lowercase comparison form while keeping display case.
  - Exports shared bounds and predicates for display names, titles, descriptions, co-organizer counts, participant counts, option limits, and current option capacity.
  - Counts Unicode code points without UTF-16 `.length` or an intermediate array.
- `src/features/appointments/validation.test.ts`
  - Covers NFKC equivalence, Unicode trimming, mixed internal whitespace, display-case preservation, lowercase comparison, empty normalized names, astral code-point limits, and every requested count or capacity boundary.
- `src/db/schema.ts`
  - Adds `length(display_name) BETWEEN 1 AND 80` and `length(normalized_name) > 0` checks to `participants`.
  - Leaves the existing appointment title, description, and option-limit checks unchanged.
- `src/db/schema.test.ts`
  - Adds live SQLite display-name boundaries, normalized-name nonempty coverage, and lowercase-expansion coverage.
  - Proves equivalent normalized names conflict within one appointment and remain valid across appointments.

## RED evidence

Runtime: Node `v24.13.0`.

Command:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/vitest/vitest.mjs run src/features/appointments/validation.test.ts src/db/schema.test.ts
```

Initial result: exit `1`. Both suites failed to load because `src/features/appointments/validation.ts` did not exist. This established the missing shared contract.

After the helper implementation, the focused helper suite passed all 39 tests while four live SQLite tests still failed: empty and 81-code-point `display_name` values, and empty and 81-code-point `normalized_name` values were accepted. This isolated the absent schema checks before they were added.

## GREEN evidence

Runtime: Node `v24.13.0`.

Focused helper and relevant live schema command:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/vitest/vitest.mjs run src/features/appointments/validation.test.ts src/db/schema.test.ts
```

Result: exit `0`; 2 test files passed; 159 tests passed; 0 failed.

Typecheck command:

```text
/tmp/appointly-node24/node_modules/node-linux-x64/bin/node node_modules/typescript/bin/tsc --noEmit
```

Result: exit `0`; no type errors.

No formatter, linter, build, or project-wide test suite was run.

## Self-review

- Exact display-name and other requested input upper bounds pass, and one-above bounds fail.
- Astral characters count as one code point in helpers and live SQLite checks.
- Name display case remains intact after NFKC and whitespace normalization; only the comparison form is lowercased.
- Count predicates reject negative, fractional, and over-limit values.
- Option capacity is available only when the current integer count is below a valid appointment option limit.
- Equivalent normalized names use the existing appointment-scoped unique index, so conflicts stay scoped to one appointment.
- Existing title, description, and option-limit SQLite checks were reused without a second schema convention.
- `git diff --check` passed.
- No migration SQL or `drizzle/` file was added or changed.

## Review fix round 1

The first schema check also capped `normalized_name` at 80 code points. Unicode lowercase conversion can expand text: 80 instances of `U+0130` form a valid 80-code-point display name but lowercase to 160 code points (`i` plus `U+0307` for each source code point). The input limit applies to the preserved display name, not the derived comparison key.

### RED

Under Node `v24.13.0`, the focused helper suite passed, while the live SQLite regression failed with:

```text
CHECK constraint failed: participants_normalized_name_length
```

Result: 1 failed and 157 passed across the two focused files. The failing case passed `normalizeParticipantName("\u0130".repeat(80))` directly into the live generated SQLite schema.

### GREEN

Changed the normalized-name check to require only `length(normalized_name) > 0`. The appointment-scoped unique index remains unchanged.

Under Node `v24.13.0`:

- Focused validation and schema tests: 2 files passed; 158 tests passed; 0 failed.
- Full `tsc --noEmit`: exit `0`; no type errors.
- No formatter, linter, build, project-wide suite, or migration generation ran.
