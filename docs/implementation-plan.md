# CrewClaw v0.18 Implementation Plan

The authoritative product contract is [`prd_v0.18.md`](./prd_v0.18.md). This file tracks the
implementation order and quality gates; it does not redefine the product boundary.

## Architecture

- `contracts/` defines the two-file employee standard and generated JSON Schemas.
- `registry/experts.json` is the marketplace/CLI source of truth.
- `experts/` contains local Hermes profile distributions.
- `packages/runtime/` is the Node reference runtime and TaskEvent producer.
- `crates/crewclaw-cli/` is the Ratatui supervision cockpit and TaskEvent consumer.
- `packages/validator/` rejects incomplete, unsafe, or version-drifted employee packages.
- The Vite/Hono website is a local-first registry projection with real package downloads.

## Current Sequence

1. Close runtime trust boundaries: public-network egress, workspace confinement, approval
   durability, artifact integrity, terminal idempotency, and cross-process state updates.
2. Make TaskEvent payloads canonical and correlation-complete, then replay the same golden JSONL
   through the Node and Rust reducers and compare semantic snapshots.
3. Make every TUI action honest: perform the side effect or emit a typed unavailable/failed event.
4. Keep `tool_needs`, permission grants, eval suites, and outcome rubrics wired into live execution.
5. Replace remaining explicitly-labelled MOCK panels only when a real data source exists.

## Required Gates

```bash
pnpm run check
pnpm run lint
pnpm run format:check
pnpm test
pnpm run test:conformance
pnpm run validate:all-experts
cargo clippy --manifest-path crates/crewclaw-cli/Cargo.toml --all-targets -- -D warnings
pnpm run build
pnpm run test:e2e
```

No gate may silently skip a known failure. Live/credentialed smoke checks must be named separately
from deterministic CI checks, with their prerequisites and skip reason explicit.

## Non-Goals

- No hosted marketplace/accounts backend in this milestone.
- No editor, file manager, browser, or long-running execution surface in the CrewClaw TUI.
- No direct writes to `~/.hermes`; use official Hermes profile commands.
