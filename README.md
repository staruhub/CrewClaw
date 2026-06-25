# CrewClaw by ChaoGeek

CrewClaw distributes ChaoGeek-certified Hermes expert profiles. The MVP keeps the existing Vite website and adds a static expert registry, local Hermes profile distributions, a validator, and a Rust CLI wrapper.

## MVP Experts

- `code-review-shrimp`: PR review, security scanning, and merge-readiness summaries.
- `product-prd-crab`: PRD review, edge cases, acceptance criteria, and metrics.
- `hermes-onboarding-conch`: Coming Soon.
- `docs-octopus`: Coming Soon.

## Local Commands

```bash
pnpm install
pnpm run check
pnpm run lint
pnpm test
pnpm run build
pnpm run validate:all-experts
pnpm run test:e2e
pnpm run test:rust
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw help
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw list
node packages/cli/bin/chaogeek-hermes.cjs list
```

## Dependency Policy

JavaScript dependencies use pnpm. Use the pinned package manager from `package.json` and keep `pnpm-lock.yaml` committed. The CrewClaw CLI is implemented in Rust under `crates/crewclaw-cli`, so keep `Cargo.lock` committed as well.

```bash
pnpm install --frozen-lockfile
```

The workspace config explicitly allows `esbuild` install scripts because Vite, Playwright-adjacent tooling, and the production bundle use esbuild binaries. Other dependency build scripts remain blocked unless reviewed and added to `pnpm-workspace.yaml`.
Rust dependencies are managed by Cargo:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml
```

## CrewClaw CLI Flow

```bash
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw
```

The no-argument command opens the CrewClaw employee picker. Choose an available expert, and the wrapper calls official Hermes profile commands for installation.
The first screen shows a clean CrewClaw ASCII banner before the expert list, so agents and humans can see they are inside the CrewClaw CLI surface without pnpm script noise or repeated line prefixes.

For direct or automated local runs:

```bash
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw hire code-review-shrimp --yes
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw hire product-prd-crab --run-first
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw doctor
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw validate experts/code-review-shrimp
```

`hire` prefers a Hermes version that supports `hermes profile install`. When an older local Hermes build lacks that command, the wrapper falls back to creating a temporary `.tar.gz` archive and importing it through `hermes profile import`. After install, CrewClaw either runs the first Hermes test when `--run-first` is passed, or prints the exact `hermes -p <profile> chat -q ...` command to run.

## Multi-agent parallel verify (`crewclaw verify`)

```bash
pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw verify
```

`crewclaw verify` sends a crew of 6 agents to fan out **in parallel** and confirm the project is runnable, each on its own live spinner lane:

| Agent | Dimension | Command |
|---|---|---|
| build-shrimp 🦐 | Rust CLI compiles | `cargo build` |
| type-crab 🦀 | TypeScript typechecks | `pnpm run check` |
| lint-octopus 🐙 | Lint & style (advisory) | `pnpm run lint` |
| unit-conch 🐚 | Unit tests | `pnpm test` |
| e2e-puffer 🐡 | End-to-end flow | `pnpm run test:e2e` |
| registry-lobster 🦞 | Expert registry valid | `pnpm run validate:all-experts` |

By default the run is scripted from `registry/verify-scenario.json` for deterministic, flake-free demos, and closes with a parallel-speedup stat (sequential ≈ 20.3s → parallel ≈ 4.5s, ~4.5× faster). `lint-octopus` is advisory and never fails the run.

Flags:

- `--live` — run the real commands above instead of the scripted scenario.
- `--ascii` — disable spinners/Unicode and print plain ASCII status lines (log- and CI-safe).

## Safety Rules

- Do not commit real `.env` files, auth files, memories, sessions, logs, workspaces, or state DBs.
- Do not write directly to `~/.hermes`; use official `hermes profile` commands.
- MCP tools should declare explicit permission allowlists or denylists.
