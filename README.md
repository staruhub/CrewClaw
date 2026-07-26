# CrewClaw by ChaoGeek

[![CI](https://github.com/staruhub/CrewClaw/actions/workflows/ci.yml/badge.svg)](https://github.com/staruhub/CrewClaw/actions/workflows/ci.yml)

CrewClaw is ChaoGeek's local-first AI Employee Platform: discover, hire, supervise, accept, and evaluate digital employees. The product combines a two-file employee standard, real evaluation runs, a Node TaskEvent runtime, a Ratatui supervision cockpit, a registry-backed storefront, and official Hermes profile distribution.

The current product boundary and roadmap are defined in [`docs/prd_v0.20.md`](docs/prd_v0.20.md). CrewClaw observes, controls, and accepts work; editors, browsers, file managers, and long-running execution belong to OpenWork.

## Release Status

The checked-in implementation is a **v0.20 release candidate**, not a tagged stable release. Product milestone versions (`v0.20`) describe the end-to-end CrewClaw contract; the Rust CLI currently has its own pre-1.0 binary version (`crewclaw-cli 0.1.0`). A release is complete only when the gates in [`docs/prd_v0.20.md`](docs/prd_v0.20.md) and [`docs/RELEASING.md`](docs/RELEASING.md) have current evidence.

## Prerequisites

- Git
- Node.js 22
- pnpm 10.33.2 (pinned by `package.json`)
- A stable Rust toolchain with `rustfmt` and `clippy`
- Chromium for browser E2E (`pnpm exec playwright install chromium`)
- Hermes only for live employee installation and model-backed runs

## Quick Start

```bash
git clone https://github.com/staruhub/CrewClaw.git
cd CrewClaw
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run crewclaw -- list
```

Copy `.env.example` to `.env.local` only when running services that need local credentials. Never commit the resulting file.

## Available Employees

[`registry/experts.json`](registry/experts.json) is the source of truth for availability and metadata.
Run `pnpm run crewclaw -- list` or open the local storefront instead of maintaining a second list here.

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
pnpm run test:runtime
pnpm run test:conformance
pnpm run crewclaw
pnpm run crewclaw -- help
pnpm run crewclaw -- list
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
pnpm run crewclaw
```

The no-argument command opens the CrewClaw employee picker. Choose an available expert, and the wrapper calls official Hermes profile commands for installation.
The first screen shows a clean CrewClaw ASCII banner before the expert list, so agents and humans can see they are inside the CrewClaw CLI surface without pnpm script noise or repeated line prefixes.

For direct or automated local runs:

```bash
pnpm run crewclaw -- hire code-review-shrimp --yes
pnpm run crewclaw -- hire product-prd-crab --run-first
pnpm run crewclaw -- doctor
pnpm run crewclaw -- validate experts/code-review-shrimp
```

`hire` prefers a Hermes version that supports `hermes profile install`. When an older local Hermes build lacks that command, the wrapper falls back to creating a temporary `.tar.gz` archive and importing it through `hermes profile import`. After install, CrewClaw either runs the first Hermes test when `--run-first` is passed, or prints the exact `hermes -p <profile> chat -q ...` command to run.

## Multi-agent parallel verify (`crewclaw verify`)

```bash
pnpm run crewclaw -- verify
```

`crewclaw verify` sends a crew of 6 agents to fan out **in parallel** and confirm the project is runnable, each on its own live spinner lane:

| Agent               | Dimension               | Command                         |
| ------------------- | ----------------------- | ------------------------------- |
| build-shrimp 🦐     | Rust CLI compiles       | `cargo build`                   |
| type-crab 🦀        | TypeScript typechecks   | `pnpm run check`                |
| lint-octopus 🐙     | Lint & style (advisory) | `pnpm run lint`                 |
| unit-conch 🐚       | Unit tests              | `pnpm test`                     |
| e2e-puffer 🐡       | End-to-end flow         | `pnpm run test:e2e`             |
| registry-lobster 🦞 | Expert registry valid   | `pnpm run validate:all-experts` |

By default the run is scripted from `registry/verify-scenario.json` for deterministic, flake-free demos, and closes with a parallel-speedup stat (sequential ≈ 20.3s → parallel ≈ 4.5s, ~4.5× faster). `lint-octopus` is advisory and never fails the run.

Flags:

- `--live` — run the real commands above instead of the scripted scenario.
- `--ascii` — disable spinners/Unicode and print plain ASCII status lines (log- and CI-safe).

## Safety Rules

- Do not commit real `.env` files, auth files, memories, sessions, logs, workspaces, or state DBs.
- Do not write directly to `~/.hermes`; use official `hermes profile` commands.
- MCP tools should declare explicit permission allowlists or denylists.

Security vulnerabilities should be reported privately as described in [`SECURITY.md`](SECURITY.md). General contribution and support guidance lives in [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SUPPORT.md`](SUPPORT.md).

## License

CrewClaw is licensed under the [Apache License 2.0](LICENSE). This covers the whole
repository, including the employee packages under `experts/` — they are open-source
examples of the two-file employee standard, and they double as fixtures for the test
and distribution gates.

Contributions are accepted under the same license (Apache-2.0 §5); see
[`CONTRIBUTING.md`](CONTRIBUTING.md).

Third-party dependencies keep their own licenses. [`docs/DEPENDENCY-LICENSES.md`](docs/DEPENDENCY-LICENSES.md)
records the notable non-permissive entries and the one dependency that ships no license
declaration at all.
