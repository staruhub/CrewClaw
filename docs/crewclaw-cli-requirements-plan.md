# CrewClaw CLI And Website E2E Requirements Plan

## Complete Requirement

CrewClaw must behave like a real ChaoGeek agent hiring surface, not like a repo-only script. A user or agent should be able to start from any terminal directory, open a CrewClaw-branded command-line interface, choose a Hermes expert employee, install that expert through official Hermes profile commands, and then either run or receive an exact first-run Hermes test command.

The website must explain this flow clearly. Expert cards and terminal previews should copy a command that works outside the repository, not `pnpm run crewclaw ...` from the current shell directory. Main website buttons, waitlist/contact modals, FAQ toggles, copied commands, and coming-soon states must all respond visibly.

## Functional Requirements

1. Any-directory CLI launcher
   - The local launcher is `pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw`.
   - Running `pnpm run crewclaw ...` from `~` is not an acceptable user path because pnpm cannot find a manifest there.
   - Website install/copy surfaces must show the any-directory launcher.

2. CrewClaw-branded CLI
   - The CrewClaw command-line logic is implemented in Rust under `crates/crewclaw-cli`; pnpm remains only the local launcher used by the website and docs.
   - CLI output starts with a visible clean CrewClaw ASCII banner.
   - The banner and prompts do not use repeated `CrewClaw:` line prefixes or wrapper border lines.
   - The CLI position is clear: `ChaoGeek AI Agent Hiring Platform` for certified Hermes expert employees.
   - Errors use `Error: ...`; cancelled prompts print `Cancelled.` and exit with code `130`.

3. Interactive employee selection
   - Running the launcher with no command opens the picker.
   - The picker lists available and coming-soon experts.
   - Available experts can be selected by number or slug.
   - Coming-soon experts are visible but blocked from install.

4. Help for humans and agents
   - `crewclaw help`, `--help`, and `-h` show usage, commands, options, and the agent instruction.
   - Help tells agents to use CrewClaw first before raw Hermes commands.
   - Help includes `--name`, `--yes`, `--force`, and `--run-first`.

5. Hermes install and first run
   - `hire` calls official `hermes profile install <source> --name <profile> --alias --yes`.
   - Older Hermes builds that lack `profile install` can fall back to a temporary archive plus `hermes profile import`.
   - CrewClaw never writes directly to `~/.hermes`.
   - After install, `--run-first` runs `hermes -p <profile> chat -q <first_task>`.
   - Without auto-run, CrewClaw prints the exact first-run Hermes command.

6. Website documentation
   - The homepage includes a CrewClaw CLI docs section.
   - The docs explain: open CrewClaw, choose an employee, install, first-run test, and help/doctor.
   - Available expert cards copy the CrewClaw launcher.
   - Coming-soon cards open waitlist, not install.

## Implementation Plan

1. Keep the existing Vite, pnpm, registry, and validator structure; implement the CrewClaw CLI behavior in Rust.
2. Update registry and website helpers so dev install commands use the any-directory CrewClaw launcher.
3. Add a reusable clipboard helper with a fallback for browser clipboard failures.
4. Refactor CLI flow:
   - Default no-command path enters the interactive picker.
   - Shared `hireExpert` handles direct and interactive hires.
   - Shared first-run logic handles `--run-first`, prompts, and guide output.
   - Help output becomes CrewClaw-first and agent-friendly.
5. Add homepage CLI documentation in the existing `HowItWorks` section.
6. Expand tests:
   - Rust CLI tests for help, list, direct hire, interactive hire, coming-soon blocking, import fallback, and first-run behavior.
   - Registry tests for the launcher command.
   - Website E2E for clickable controls, copy behavior, CLI docs visibility, waitlist/contact modals, FAQ, and Hermes profile install smoke test.
7. Verify:
   - `pnpm run check`
   - `pnpm run lint`
   - `pnpm test`
   - `pnpm run validate:all-experts`
   - `pnpm run build`
   - `pnpm run test:e2e`
   - `cargo test --manifest-path crates/crewclaw-cli/Cargo.toml`
   - Manual CLI smoke from `/Users/pongpong`.
   - Hermes profile list/info smoke with a temporary profile name.
8. Kill old related dev servers and start a fresh server at `http://127.0.0.1:3000/`.

## Acceptance Criteria

- From `/Users/pongpong`, `pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw help` succeeds and shows CrewClaw-branded help.
- From `/Users/pongpong`, `pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw` opens the CrewClaw picker with a visible ASCII banner before the prompt.
- Selecting Code Review Shrimp installs a temporary Hermes profile without writing directly to `~/.hermes`.
- `--run-first` attempts the first Hermes chat test; otherwise CrewClaw prints the exact command.
- Website expert cards copy `pnpm --silent -C /Volumes/Ventoy/Playground/crewhire run crewclaw`.
- All major homepage controls visibly respond.
- All listed verification commands pass, or any environmental blocker is documented with exact failing output.
