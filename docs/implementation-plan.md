# ChaoGeek Hermes Experts MVP Implementation Plan

## Architecture

CrewClaw keeps the existing Vite application and adds an incremental expert distribution layer:

- `registry/experts.json` is the source of truth for website and CLI expert metadata.
- `experts/` contains local Hermes profile distributions.
- `packages/validator` validates profile structure and safety.
- `crates/crewclaw-cli` implements the CrewClaw command-line surface in Rust and wraps official `hermes profile` commands.
- `packages/cli/bin/chaogeek-hermes.cjs` is only a local Node bin bridge into the Rust CLI.

## MVP Sequence

1. Maintain the current Vite website and pnpm scripts.
2. Add P0 expert profiles for `code-review-shrimp` and `product-prd-crab`.
3. Validate expert packages with `pnpm run validate:all-experts`.
4. Use `pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw` for local interactive CLI smoke tests from any directory.
5. Run `pnpm run check`, `pnpm run lint`, `pnpm test`, `cargo test --manifest-path crates/crewclaw-cli/Cargo.toml`, `pnpm run build`, and `pnpm run test:e2e`.
6. Start a fresh local dev server after changes for manual testing.

## Hermes Compatibility

The CLI wrapper prefers Hermes profile distribution support through `hermes profile install`. Older local Hermes builds can still be smoke-tested through the wrapper's local-directory fallback: it creates a temporary `.tar.gz` archive and imports it with `hermes profile import --name`.

## Non-Goals

- No Next.js migration in this MVP.
- No multi-package workspace split beyond the current incremental `packages/` layout.
- No paid registry, enterprise private registry, or analytics upload.
- No direct writes to `~/.hermes`.
