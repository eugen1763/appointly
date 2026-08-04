# Task 40: Apply accessible global visual design

Apply the approved Appointly visual and accessibility contract across every user-visible route.

## Required design contract

- Keep the existing calm utility-ledger direction. Use system fonts only.
- Use the exact global palette: background `#F7F5F0`, surface `#FFFFFF`, text `#1F2933`, muted text `#5F6B7A`, border `#D8D3C8`, action and focus blue `#1D4ED8`, Yes green `#137A4A`, No red `#B42318`, and warning amber `#8A4B08`.
- Centralize the exact palette in `src/app/globals.css`. User-interface modules consume tokens instead of introducing hard-coded colors.
- Preserve visible focus for all interactive controls and respect reduced-motion preferences.
- Give every interactive control at least a 44px target in every state.
- Use semantic heading order, explicit labels, linked field errors, native keyboard controls, and useful live or alert semantics.
- Never use color as the only state signal. Yes, No, warning, selected, error, and current-step states must include text, shape, border, or another non-color signal.
- Preserve the current product vocabulary and the existing utility-ledger aesthetic. Do not fetch fonts, add dependencies, add a UI kit, or create decorative animation.

## Scope

- Audit `src/app/globals.css`, `src/app/routes.module.css`, `src/app/a/[publicId]/appointment.module.css`, and `src/app/a/[publicId]/edit/edit.module.css`.
- Audit user-visible TSX in `src/app`, plus `src/features/appointments/AppointmentCreationWizard.tsx`, only where semantic markup or accessible state wiring must change.
- Reuse current selectors and tokens. Remove obsolete or duplicate styling when safe.
- Do not change domain behavior, API behavior, route contracts, server code, or feature copy.
- Do not implement the separate responsive table-to-card architecture from Task 41. Existing narrow-layout rules may remain. Limit this task to global visual consistency and accessibility.

## Acceptance

- Every page uses the approved palette and system-font tokens.
- Every interactive control has a visible focus state and a minimum 44px target.
- Form controls have explicit accessible names. Field errors are programmatically associated where applicable.
- State and result meaning never depends on color alone.
- Heading structure remains valid on the landing, sign-in, dashboard, creation, public appointment, and edit-link routes.
- No horizontal-width redesign or table/card duplication is introduced.
- The coordinator runs browser accessibility and visual smoke checks after implementation.
- Skip formatters, linters, builds, TypeScript, and all tests. Commit nothing; the coordinator validates and commits.
