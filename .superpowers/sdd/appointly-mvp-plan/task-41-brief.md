# Task 41: Build responsive table and card layouts

Complete the approved public appointment responsive interface without changing domain behavior.

## Required responsive contract

- At widths of 768 CSS pixels and above, show only the participant-row and option-column availability table.
- The desktop table keeps sticky participant-name cells and sticky option-header cells inside a bounded horizontal and vertical scroll area.
- The table preserves the snapshot order: chronological option columns and creation-order participant rows.
- The table shows textual Yes, No, and Unanswered values plus Yes, No, and Unanswered totals for every option.
- Below 768 CSS pixels, show only one option card per candidate.
- Each mobile card shows the option label, textual Yes/No/Unanswered totals, final-selection state when applicable, and a native keyboard-accessible disclosure for its participant vote list.
- The disclosure must have a useful accessible name, a visible open/closed cue that does not depend on color, and a minimum 44px summary target.
- The three-state response control keeps an explicit accessible name for every option and full 44px label targets.
- Joining, the saved-participant selector, suggestion controls, final status, private copy links, and all manager actions must remain usable without horizontal overflow at 320 CSS pixels.

## Scope

- Own `src/app/a/[publicId]/PublicAppointmentView.tsx`, its focused tests if existing expectations require updates, and `src/app/a/[publicId]/appointment.module.css`.
- Reuse the current table, mobile-card, global token, and option-label patterns.
- Use native `details` and `summary` for mobile participant-vote disclosure unless an existing native pattern is stronger.
- Preserve all public component props, response data attributes, option/participant ordering, selected-state markers, timed-option hydration behavior, and server/client boundaries.
- Do not change snapshots, routes, services, API contracts, domain rules, persistence, copy outside the disclosure control, dependencies, or the approved palette.

## Acceptance

- At 767px, mobile cards are visible and the desktop table is hidden.
- At 768px and above, the table is visible and mobile cards are hidden.
- The table scroll container and sticky row/header cells remain functional with many options and participants.
- Every mobile card has one collapsed participant-vote disclosure that toggles with pointer and keyboard input.
- Opening one disclosure reveals the creation-order participant list with textual response values.
- Final selection uses text and border/shape in both layouts.
- Every visible control at 320px fits without page-level horizontal overflow and has at least a 44px target.
- The coordinator validates 320px, 767px, 768px, and desktop behavior in a live browser.
- Skip formatters, linters, builds, TypeScript, and project-wide tests. Commit nothing; the coordinator validates and commits.
