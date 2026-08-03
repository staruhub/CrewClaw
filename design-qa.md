# CrewClaw design QA

## Result

final result: passed

- Final visual-verdict score: **91/100**
- Pass threshold: **90**
- Verified prototype: `http://localhost:3000/`
- Clean final browser console: **0 errors, 0 warnings**

## Source of truth

The supplied design package was extracted to `D:/Playground/crewclaw/design-reference` and captured at the same desktop viewport used for implementation QA.

| Surface     | Reference                                                        |
| ----------- | ---------------------------------------------------------------- |
| Landing     | `artifacts/design-qa/references/landing-v4-hero-reference.png`   |
| Marketplace | `artifacts/design-qa/references/landing-v5-market-reference.png` |
| Workbench   | `artifacts/design-qa/references/tui-workbench-reference.png`     |

## Implementation captures

| Surface     | Desktop                                                      | Mobile                                                      |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Landing     | `artifacts/design-qa/implementation/home-desktop.png`        | `artifacts/design-qa/implementation/home-mobile.png`        |
| Marketplace | `artifacts/design-qa/implementation/marketplace-desktop.png` | `artifacts/design-qa/implementation/marketplace-mobile.png` |
| Workbench   | `artifacts/design-qa/implementation/workbench-desktop.png`   | `artifacts/design-qa/implementation/workbench-mobile.png`   |

The final clean landing handoff is recorded at `artifacts/design-qa/implementation/final-home-clean.png`.

## Viewports and density

- Desktop comparison viewport: **1265 × 720**
- Mobile verification viewport: **390 × 844**
- Landing: centered hero, copper primary action, and terminal surface peeking below the fold.
- Marketplace: compact headline followed immediately by a terminal-first, functional candidate browser with integrated search and evidence filters.
- Workbench at `lg`: `244px / minmax(0, 1fr) / 284px` operational columns with compact spacing, full timeline, event detail, evidence rail, and persistent bottom input.
- Mobile captures show no visible horizontal overflow or overlapping controls.

## Comparison history

| Iteration      | Score | Outcome | Changes made                                                                                                                                                                             |
| -------------- | ----: | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline       |    72 | Failed  | Landing was split, marketplace was card-first, and workbench was a low-density web detail page.                                                                                          |
| Alignment pass |    84 | Failed  | Centered the landing hero, added terminal marketplace/workbench surfaces, and increased operational density.                                                                             |
| Final pass     |    91 | Passed  | Made the marketplace console primary and functional, used concrete example/license/runtime fields, and compressed workbench chrome so the complete supervisory frame fits at 1265 × 720. |

Final combined comparisons:

- `artifacts/design-qa/comparisons/landing-side-by-side.png`
- `artifacts/design-qa/comparisons/marketplace-side-by-side.png`
- `artifacts/design-qa/comparisons/workbench-side-by-side.png`

## Interaction verification

Verified with the in-app browser and Computer Use:

1. Clicked the landing primary CTA with Computer Use and reached Marketplace.
2. Compared employees, searched for Macao, opened the real profile, and carried task/budget/runtime/access intent into hiring.
3. Reviewed the open-source access boundary, ran Doctor, resolved the `places.search` blocker, ran and accepted the bounded trial, activated local hire, and wrote the durable local roster record.
4. Inspected TaskRun evidence, selected timeline rows by mouse and keyboard, created a revision payload, and exercised the human approval boundary.
5. Verified Performance KPI honesty, Metrics, and Crew Mode Dream staged review.
6. Offboarded the temporary validation employee through the product UI with an exported memory pack; no active validation hire remains.

## Automated evidence

- TypeScript check: passed.
- ESLint with zero warnings: passed.
- Unit/runtime/Rust test command: **289 Vitest + 110 deterministic runtime + 353 Rust tests passed**.
- Browser E2E: **9/9 passed** across install, hire, closed-loop activation, performance/Dream, and TaskRun supervision.
- Production build: passed for Vite, generated employee packages, API bundle, and release Rust CLI.
- `git diff --check`: passed.

## Findings

Resolved:

- Canonical Windows short-name/long-name path handling for guarded state, approval receipts, validator fixtures, CLI fixtures, and browser install E2E.
- Capability-token mismatch that prevented a real local hire after trial acceptance.
- Positional approval fallbacks, unsafe revision command interpolation, and mouse-only timeline selection.
- Lost hire handoff fields for intended task, budget, runtime, source, and requested access.
- Generic visual hierarchy in the three supplied reference surfaces.

Remaining non-blocking note:

- Vite reports a production chunk-size warning for the existing main bundle. The build succeeds and no runtime error was observed; future route-level code splitting can reduce the initial bundle.
