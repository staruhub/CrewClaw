# Multi-Agent Parallel Verify — Design Spec

## Summary

`crewclaw verify` makes a crew of 6 C1 package-validated agents fan out **in parallel** to verify that the project is runnable. Each agent owns one verification dimension (build, types, lint, unit, e2e, registry) and reports a verdict on its own live spinner lane. The demo is **scripted/data-driven** by default — durations and verdicts come from `registry/verify-scenario.json` so the roadshow run is fast and deterministic. Scripted results are demo data, not C2 certification; `--live` swaps the scripted steps for the real shell commands.

## The Crew (6 agents)

| Agent            | Emoji | Dimension               | Real command                    |
| ---------------- | ----- | ----------------------- | ------------------------------- |
| build-shrimp     | 🦐    | Rust CLI compiles       | `cargo build`                   |
| type-crab        | 🦀    | TypeScript typechecks   | `pnpm run check`                |
| lint-octopus     | 🐙    | Lint & style (advisory) | `pnpm run lint`                 |
| unit-conch       | 🐚    | Unit tests              | `pnpm test`                     |
| e2e-puffer       | 🐡    | End-to-end flow         | `pnpm run test:e2e`             |
| registry-lobster | 🦞    | Expert registry valid   | `pnpm run validate:all-experts` |

`lint-octopus` is **advisory**: its findings are reported but never fail the overall run. All others are blocking.

## Architecture

- **New module:** `src/verify.rs` in `crates/crewclaw-cli`, declared via `mod verify;` in `main.rs`.
- **Wiring:** `run_cli` already routes `verify` / `check` / `校验` to `verify::run_verify(args, root)`. The module owns all verify-specific logic and types; it does not touch the hire/registry path.
- **Scenario source:** reads `registry/verify-scenario.json` (title, tagline, and per-agent `id/emoji/name/role/command/steps[]/verdict/summary/advisory`). Deserialized with `serde` into a `Scenario { agents: Vec<Agent> }` shape.
- **Parallelism:** one `std::thread` per agent (6 threads). Each thread walks its `steps[]`, sleeping `duration_ms` per step in scripted mode (or running the real command in `--live`), and drives its own [`indicatif`] spinner lane inside a shared `MultiProgress`. The main thread joins all handles and collects verdicts.
- **Summary panel:** after all lanes finish, prints a per-agent verdict table plus a **parallel-speedup stat** — sequential total ≈ 20.3s (sum of all step durations) vs parallel wall-clock ≈ 4.5s (the slowest single lane), labeled `~4.5× faster`.
- **Flags:**
  - `--live` — run the real commands instead of the scripted steps.
  - `--ascii` — disable spinners/Unicode; render plain ASCII status lines for log-safe and CI-safe output.

## Data Flow

1. `run_verify` parses flags (`--live`, `--ascii`) and loads `registry/verify-scenario.json` (errors out cleanly if missing/malformed).
2. Builds a `MultiProgress` and one `ProgressBar` lane per agent (or plain line writers under `--ascii`).
3. Spawns one thread per agent; each thread runs its steps (scripted sleeps or live `Command`), advancing its lane and recording a final verdict + elapsed.
4. Main thread joins all threads, aggregates verdicts and timings.
5. Prints the summary panel: verdict per agent, advisories, and the sequential-vs-parallel speedup stat.

## Error Handling

- **Missing/invalid scenario file** → `Err(String)` surfaced by `run_cli` as `Error: …`, exit `1`.
- **Scripted mode** never fails on command behavior — verdicts are taken from the scenario.
- **`--live` mode** maps each agent's real command exit code to a verdict; `lint-octopus` non-zero is downgraded to `advisory` (non-blocking). Any other blocking agent failure makes the overall exit code non-zero.
- **Exit code:** `0` when all blocking agents pass; non-zero if any blocking agent fails. Advisories alone do not fail the run.
- Ctrl-C is handled by the existing global cancel handler (exit `130`).

## Testing

- Unit tests in `verify.rs`: scenario deserialization, verdict aggregation (advisory does not fail the run; a blocking failure does), and the speedup calculation (sum-of-steps vs max-lane).
- Reuse the existing `#[cfg(test)]` style already in `main.rs`.
- A scripted `crewclaw verify` is itself deterministic, so it can be asserted on in CI without spinners (`--ascii`).

## YAGNI / Scope

- **Terminal only.** No web UI, no dashboard, no HTTP surface.
- **No real model/agent calls.** The "agents" are themed verification lanes, not LLM sessions.
- **Scripted by default.** Real commands run only under `--live`; the default demo path touches no toolchain.
- **No new dependencies beyond `indicatif`** (+ `serde`/`serde_json` already present).
- **No persistence, no caching, no parallelism tuning knobs** — fixed 6 threads, one per agent.
- **No partial/selective runs** (e.g. `verify type-crab`) in v1; the crew always runs as a whole.
