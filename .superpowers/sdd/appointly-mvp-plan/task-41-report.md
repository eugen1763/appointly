# Task 41 report: responsive availability ledger

## Scope completed

Implemented the approved responsive ledger contract in:

- `src/app/a/[publicId]/PublicAppointmentView.tsx`
- `src/app/a/[publicId]/appointment.module.css`

No focused test expectations required changes. No routes, snapshots, services, `AppointmentClient` behavior, component props, dependencies, option labels, domain logic, or unrelated styles were changed.

## Implementation details

### Mobile option cards below 768px

Each existing option card now contains exactly one native `details`/`summary` disclosure around its participant response list.

- The disclosure has no `open` attribute, so it is collapsed by default.
- The visible summary label is `Participant responses`.
- The summary references the card's option heading with `aria-describedby`, giving the repeated disclosure control option-specific context while continuing to use the existing hydrated `OptionLabel` output.
- The visible cue changes from `Show +` while closed to `Hide −` while open. Text plus the plus/minus shape communicates state without relying on color.
- Cue text is `aria-hidden` because the native disclosure already exposes its expanded/collapsed state and the summary supplies the accessible name.
- The summary uses the existing `--target-size` token for a 44px minimum target and retains the global focus-visible outline.
- The summary layout uses the existing spacing, color, typography, border, and background tokens. Its flexible label and fixed cue avoid introducing a fixed mobile width.
- The participant `ul`, its `Participant responses` accessible label, participant-name markers, option/participant data markers, textual response values, and participant mapping order are preserved inside the disclosure.

The existing card heading, selected-state text and border treatment, and Yes/No/Unanswered totals remain outside the disclosure and therefore remain visible while the participant list is collapsed.

### Desktop ledger at 768px and above

The desktop availability table markup was intentionally left unchanged, preserving:

- chronological option-column order;
- creation-order participant rows;
- textual Yes, No, and Unanswered cells;
- Yes, No, and Unanswered total rows;
- selected-option text, structure, and data markers;
- all option and participant data attributes.

The desktop media query now uses the exact `768px` threshold. At that threshold the ledger becomes the only displayed layout and receives explicit `width: 100%` and `max-width: 100%` bounds plus its existing tokenized maximum height and `overflow: auto`. The existing sticky option headers, sticky participant-name cells, and elevated sticky corner remain unchanged inside that horizontal and vertical scroll container.

The mobile cards remain the default below the media query and are hidden inside the same `min-width: 768px` rule, so there is no 767px/768px overlap:

- 767px and below: mobile cards only;
- 768px and above: desktop table only.

## 320px protections

Source inspection confirms the new mobile disclosure adds no fixed width or minimum inline width. Its summary:

- uses a flexible row with tokenized padding and gap;
- keeps only the short state cue non-wrapping;
- uses the shared 44px target token;
- leaves the existing participant-name `min-width: 0` and `overflow-wrap: anywhere` behavior intact.

All response controls and non-ledger actions were left unchanged, including their existing narrow-screen rules and Task 40 target/focus behavior.

## Preserved Task 40 accessibility

- Mobile option headings remain `h3` elements subordinate to the Availability `h2`.
- Existing explicit response-control names and 44px response labels are unchanged.
- Existing textual state labels and non-color selected-state borders remain unchanged.
- The global focus-visible treatment continues to apply to the keyboard-focusable native summary.
- Timed option label hydration is reused directly and was not duplicated or modified.

## Validation boundary

Per the task instructions, no formatter, linter, build, TypeScript check, test command, browser validation, commit, or other validation command was run. The coordinator should exercise the responsive ledger in a live browser at 320px, 767px, 768px, and desktop widths, including keyboard and pointer toggling of each disclosure and both-axis scrolling with many options and participants.
