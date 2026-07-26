# Third-Party Dependency Licenses

CrewClaw ships under [Apache-2.0](../LICENSE). Dependencies keep their own terms.
`pnpm-lock.yaml` and `Cargo.lock` are the authoritative record; this file only tracks
the entries that are **not** plainly permissive, so a reviewer does not have to
re-derive them.

Regenerate the survey with:

```bash
pnpm licenses list --prod
```

## Summary (production dependencies)

At the v0.20 release candidate: 332 production packages, of which 328 are permissive
(MIT 266, ISC 28, Apache-2.0 16, BSD-2/3-Clause 19, 0BSD/Unlicense/CC0 3). The
remaining entries are listed below.

## Entries that need a decision from a redistributor

| Package     | Declared license            | How it reaches us                                                                                       | Assessment                                                                                                                                                                                                                                                                                    |
| ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jschardet` | LGPL-2.1+                   | Direct dependency of the root package; used by `packages/runtime/tools-files.mjs` for charset detection | Consumed as an unmodified npm package and loaded dynamically. LGPL §6 obligations are satisfied by keeping it a separate, replaceable module and retaining its copyright notice. We do not fork or statically embed it. If you redistribute a bundle that inlines it, review §6 for yourself. |
| `buffers`   | **None declared**           | Transitive: `exceljs` → `unzipper` → `binary` → `buffers`                                               | **Known gap.** The package publishes no license field and no LICENSE file, so no redistribution grant is on record. It is only reachable through `exceljs` (xlsx reading in `tools-files.mjs`). Tracked as a follow-up: either obtain a grant upstream or replace `exceljs`.                  |
| `jszip`     | MIT **or** GPL-3.0-or-later | Transitive via `exceljs` and `mammoth`                                                                  | Dual-licensed; we take the MIT option, which is compatible with Apache-2.0. No action needed.                                                                                                                                                                                                 |

## Notes

- Apache-2.0 is one-way compatible with GPL-3.0 but not GPL-2.0. No GPL-2.0-only
  dependency is present.
- The Rust crate (`crates/crewclaw-cli`) sets `publish = false` and its dependency tree
  is permissive; `Cargo.lock` is committed for reproducibility.
- Employee packages under `experts/` are first-party and Apache-2.0 like the rest of the
  repository.
