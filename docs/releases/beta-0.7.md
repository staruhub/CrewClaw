# CrewClaw Beta 0.7

Beta 0.7 turns CrewClaw's design-aligned storefront and workbench into a verified local-first employee workflow. It is a GitHub prerelease, not a stable compatibility promise.

## Highlights

- Reworked the landing page, marketplace, employee detail, and hire confirmation experience for the approved desktop and mobile direction.
- Closed the hire loop with Doctor checks, trial execution, explicit capability grants, and a persisted local roster.
- Added TaskRun evidence, artifacts, revisions, and approval decisions to the web and terminal workbench surfaces.
- Connected employee, team, review, and performance views to honest runtime-backed signals instead of decorative success data.
- Hardened Windows path handling and local-only mutation boundaries.
- Added production-safe Fly.io binding and deployed the web experience to [crewhire.fly.dev](https://crewhire.fly.dev/).

## Install

Beta 0.7 is currently distributed from source:

```bash
git clone --branch beta-0.7 https://github.com/staruhub/CrewClaw.git
cd CrewClaw
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
pnpm run crewclaw -- list
```

## Upgrade

For an existing clone:

```bash
git fetch origin --tags
git checkout beta-0.7
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
```

Back up local `.crewclaw/` state before switching versions when it contains employee or run data you need to preserve.

## Rollback

Return to the previous checked-out revision without deleting local state:

```bash
git switch -
pnpm install --frozen-lockfile
pnpm run build
```

If the previous revision expects a different local-state shape, restore the `.crewclaw/` backup made before upgrading.

## Verification

The release snapshot was checked with:

- TypeScript project references: `pnpm run check`
- ESLint: `pnpm run lint`
- Vitest, deterministic runtime tests, and Rust tests: `pnpm run test`
- Focused Playwright coverage for installation, hire, TaskRun, and design alignment
- Production build: `pnpm run build`
- Git whitespace validation: `git diff --check`
- Fly.io health checks and browser smoke coverage against `https://crewhire.fly.dev/`

## Known Limits

- This is a prerelease; interfaces and local-state schemas may still change.
- Live provider-backed runtime probes require the operator's own Hermes/provider credentials and are not part of deterministic CI.
- Production browser smoke checks cover the public web workflow; machine-local Hermes execution remains intentionally local.
- The current Vite production build reports a non-blocking large-chunk warning.

## License

CrewClaw source is provided under the Apache License 2.0. Employee-package-specific terms, where present, remain documented with those packages.
