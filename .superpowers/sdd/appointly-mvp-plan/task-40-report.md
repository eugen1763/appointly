# Task 40 report: accessible global visual design

## Scope completed

Audited the required visual system and every user-visible route/component in scope without changing domain services, API routes, route contracts, dependencies, tests, copy, or the Task 41 table/card responsive architecture.

### Style files audited

- `src/app/globals.css`
- `src/app/routes.module.css`
- `src/app/a/[publicId]/appointment.module.css`
- `src/app/a/[publicId]/edit/edit.module.css`

### User-visible TSX audited

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/_components/AvailabilityStrip.tsx`
- `src/app/sign-in/page.tsx`
- `src/app/sign-in/SignInAction.tsx`
- `src/app/dashboard/page.tsx`
- `src/app/appointments/new/page.tsx`
- `src/features/appointments/AppointmentCreationWizard.tsx`
- `src/app/a/[publicId]/page.tsx`
- `src/app/a/[publicId]/AppointmentClient.tsx`
- `src/app/a/[publicId]/GuestIdentitySelector.tsx`
- `src/app/a/[publicId]/JoinParticipantForm.tsx`
- `src/app/a/[publicId]/PublicAppointmentView.tsx`
- `src/app/a/[publicId]/SuggestionForm.tsx`
- `src/app/a/[publicId]/option-label.tsx`
- `src/app/a/[publicId]/edit/page.tsx`
- `src/app/a/[publicId]/edit/EditLinkClient.tsx`

## Files changed and decisions

### `src/app/a/[publicId]/PublicAppointmentView.tsx`

- Changed each mobile appointment-option heading from `h2` to `h3`.
- This keeps option headings subordinate to the enclosing `Availability` `h2` while preserving the rendered option content and existing mobile-card structure.

### `src/app/a/[publicId]/AppointmentClient.tsx`

- Assigned stable IDs to each per-option autosave status and save error.
- Linked each response `fieldset` to its current save status or error with `aria-describedby`.
- Preserved the existing polite live status and alert behavior, response values, save behavior, retry behavior, and component props.

### `src/app/a/[publicId]/JoinParticipantForm.tsx`

- Represented private-link copy feedback as an explicit success/error state without changing either message.
- Successful copy feedback remains a status; failed copy feedback is now an alert and uses the existing error presentation.
- Join behavior, clipboard behavior, public props, and copy are unchanged.

### `src/features/appointments/AppointmentCreationWizard.tsx`

- Linked the details form to appointment submission errors.
- Linked the candidate editor form to candidate errors.
- Linked the create action to appointment submission errors shown in the options step.
- Added stable IDs only to existing error messages; validation rules, transitions, submission behavior, and copy are unchanged.

### `src/app/a/[publicId]/appointment.module.css`

- Updated the mobile option-heading selector to match the corrected `h3` markup.
- Added a non-color selected-state cue for response and final-option labels by applying stronger type weight when their native radio is checked; the existing checked radio and action-colored border remain.
- Continued using only the global palette, spacing, radius, typography, focus, and target-size tokens.

### Audited without source changes

- `src/app/globals.css`: already centralizes the exact approved background, surface, text, muted text, border, action/focus, Yes, No, and warning values; defines system UI/data font stacks; provides a global visible `:focus-visible` outline; and disables transitions under reduced-motion preferences.
- `src/app/routes.module.css`: already consumes global tokens, gives links/buttons/form controls a `--target-size` minimum, retains textual Yes/No/Unanswered and current-step labels, and presents errors with text and alert wiring from the components.
- `src/app/a/[publicId]/edit/edit.module.css`: already consumes tokens and gives the return link a `--target-size` minimum.
- The remaining audited TSX already had valid page-level heading order, explicit labels or accessible names, native keyboard controls, textual state labels, and suitable status/alert semantics for the states they render.

## Accessibility coverage

### Palette and typography

- The only literal interface colors are the approved values centralized in `globals.css`.
- Route modules consume `--color-*` variables rather than introducing local colors.
- Body text uses `--font-ui`; ledger/data accents use the system-based `--font-data`; form controls inherit the current font.

### Focus, keyboard, and targets

- Global `:focus-visible` supplies a visible action-blue outline and offset to native and custom-styled interactive elements.
- Reduced-motion preferences suppress transitions.
- Styled links, buttons, text fields, textareas, selects, response labels, and final-option labels use the 2.75rem (44px at the root size) target token or have a larger text-and-padding hit area.
- Radio choices remain native keyboard controls, with their full 44px-or-larger labels acting as the pointer/touch target.
- Native `dialog` elements retain Escape handling and explicit focus placement/restoration in the existing client code.

### Names, descriptions, and errors

- Text inputs, date/time controls, selects, textareas, radios, and action buttons retain explicit labels or accessible text.
- Existing field errors remain linked with `aria-describedby` and marked invalid where applicable.
- Wizard candidate/submission errors and response autosave errors are now linked to the relevant form, action, or fieldset.
- Sign-in, join, suggestion, finalization, deletion, refresh, edit-link, copy, and wizard failures retain alert semantics; successful asynchronous feedback retains status/live semantics.

### Non-color state signals

- Yes, No, and Unanswered are always written as text.
- Finalized, Active, read-only/editing, selected option, current step, warning, saving/saved, copied/failed, and error states all include text and/or a structural cue in addition to color.
- Checked response/final-option labels now gain type weight as an additional non-color cue while preserving the native radio check indicator.
- Warning and destructive states retain descriptive text and ledger-style borders; errors retain visible messages and alert semantics.

### Heading structure

- Landing, sign-in, dashboard, creation, public appointment, and edit-link routes retain one page `h1` followed by appropriate `h2` sections.
- Mobile appointment-option headings are now `h3` children of the `Availability` section rather than peers of its `h2`.
- Wizard candidate-ledger and share headings remain correctly nested under the creation page heading.

## Scope protections

- No domain service, API route, server behavior, route/component prop contract, dependency, test, or copy changed.
- No horizontal-width redesign, duplicated table/card markup, breakpoint change, or Task 41 responsive architecture was introduced.
- No formatter, linter, build, type-check, test, or commit command was run, as required by the task brief.

## Remaining risks and coordinator checks

- Source inspection confirms token use and declared 44px minimums, but actual computed sizes, contrast, focus visibility, and clipping should still be checked in the coordinator's browser smoke pass at representative zoom and viewport sizes.
- Conditional paths requiring authentication, guest edit links, clipboard denial, save failure, finalization, reopen, and destructive dialogs need browser exercise with suitable data to confirm their runtime accessibility trees.
- The selected-label enhancement continues the module's existing use of `:has()`; supported target browsers should be confirmed by the coordinator if legacy browser support is required.
- The desktop ledger and mobile cards were deliberately not re-architected here; any responsive table/card concerns remain Task 41 scope.
