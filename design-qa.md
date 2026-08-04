# CrewClaw employee profile design QA

## Result

final result: passed

- Verified route: `http://localhost:3000/employee/code-review-shrimp`
- Desktop comparison raster: **1024 × 768** per side
- Browser console: **0 errors**
- TypeScript, ESLint, and production web build: passed

## Visual comparison

The selected “resume directory” concept and the final implementation were
normalized to the same 1024 × 768 comparison raster and reviewed together.

- Reference: `artifacts/design-qa/references/employee-profile-selected.png`
- Implementation: `artifacts/design-qa/implementation/employee-profile-desktop.png`
- Side-by-side: `artifacts/design-qa/comparisons/employee-profile-side-by-side.png`

The implementation preserves the selected direction’s near-black and copper
visual language, compact candidate header, résumé snapshot, left-hand numbered
directory, wide reading column, restrained separators, and an open first
module. It intentionally keeps CrewClaw’s existing buttons, badges, typography,
and truthful registry-backed status language.

## Interaction verification

- Role overview is expanded on first load.
- The directory exposes six modules and scrolls to the selected module.
- Permission boundaries expand from the directory and expose the real runtime,
  capability, scope, and safety content.
- Accordion triggers support independent expand and collapse states.
- Hire, save, team, package download, trial command, and review controls remain
  connected to their existing product behavior.
- Responsive classes turn the desktop directory into an in-flow, multi-column
  selector below the `lg` breakpoint without horizontal overflow.

## Content integrity

- No fabricated rating, hire count, price, billing, or checkout copy was added.
- Internal `mock:false` wording was removed from public marketplace copy and
  replaced with plain-language references to real profile runs.
- Evidence, availability, package, lab, field, and publication statuses remain
  derived from the employee registry and local performance sources.

## Remaining non-blocking note

The existing Vite main-bundle size warning remains unchanged. The build
succeeds; route-level code splitting can be handled separately.
