# AGENTS.md

## Project

This repo builds **CrewClaw by ChaoGeek: an AI Employee Platform** — discover, hire, deploy, use,
and evaluate digital employees. One line: _OpenCode makes AI able to work; OpenWork gives AI a
computer; CrewClaw proves which AI employee deserves to be hired._

Components: the two-file employee standard (`hire.yaml` hiring contract + `crewclaw.employee.yaml`
runtime spec, JSON Schemas in `contracts/schema/`), the employee registry + validator, the Node
reference runtime (`packages/runtime`, TaskEvent JSONL), the Ratatui supervision workbench
(`crates/crewclaw-cli`), the evaluation runner (real benchmark scores), and the local-first
marketplace website (Vite + hono, real package downloads). Authoritative product doc:
`docs/prd_v0.18.md` (versioned with the implementation; boundary charter included).

## Boundaries (charter, 2026-07-10)

- **CrewClaw TUI = supervision cockpit** (observe / control / accept). Built features stay; new
  features may only be simple preview/viewing. Editors, file managers, browsers, long-running
  execution belong to **OpenWork** — never rebuild them here.
- **Website = local-first storefront**: a projection of the registry + real package downloads.
  Hosted marketplace (accounts/backend) is an explicit far-future milestone.
- **TaskEvent is additive-only**: never change existing event semantics; add variants.
- **Honesty rules**: use real data where it exists, label MOCK explicitly where it doesn't, never
  fabricate; a mock eval score never overwrites a real (mock:false) certification score.
- Hermes Agent is the external runtime target. Do not fork or modify Hermes internals; do not
  write directly to `~/.hermes`; use official `hermes profile` commands.
- Do not commit `.env`, `auth.json`, memories, sessions, logs, state DBs, workspaces, or user data
  (single source: `contracts/forbidden-paths.ts`).

## Commands

- `pnpm run check` / `pnpm run lint` / `pnpm test`
- `pnpm run test:runtime` / `pnpm run test:conformance`
- `cargo test --manifest-path crates/crewclaw-cli/Cargo.toml`
- `pnpm run validate:all-experts`
- `pnpm run schema:generate`
- `pnpm eval:expert <slug> [--mock]`
- `pnpm run test:e2e`
- `pnpm run crewclaw list`

## Employee Package Rules

Every available expert must include BOTH standard files — `hire.yaml` (validated by
`contracts/manifest.ts`) and `crewclaw.employee.yaml` (validated by `contracts/employee-spec.ts`,
eval_suite + outcome_rubric required) — plus `distribution.yaml`, `README.md`, `SOUL.md`,
`config.yaml`, `mcp.json`, `.env.EXAMPLE`, `CERTIFICATION.md`, `EXAMPLES.md`, `EVALS.md`,
`CHANGELOG.md`, and at least one `skills/**/SKILL.md`. Versions must agree across registry /
hire.yaml / distribution.yaml / spec.

## Done Means

Real behavior wired into the live path and exercised end to end — not scaffolding, not orphaned
modules, not just green unit tests. All checks pass, the validator rejects unsafe packages, the
website builds, and Rust-side changes are release-built and deployed (rename trick over the
running `crewclaw.exe`).
