# Contributing to CrewClaw

Thanks for helping improve CrewClaw. Contributions should preserve the project's local-first, evidence-bearing, and fail-closed behavior.

## Development Setup

Prerequisites are listed in the root `README.md`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run test:unit
```

Do not commit `.env` files, credentials, memories, sessions, logs, databases, workspaces, generated test output, or compiled binaries. The canonical forbidden-path rules live in `contracts/forbidden-paths.ts`.

## Before Opening a Pull Request

Run the deterministic gate:

```bash
pnpm run ci:check
```

For changes that affect user flows or distribution, also run:

```bash
pnpm run test:e2e
```

If contracts or generated employee data changed, run `pnpm run schema:generate` and confirm that every generated diff is intentional.

## Pull Request Expectations

- Keep changes scoped and explain the user-visible outcome.
- Add regression coverage for behavior changes.
- Preserve TaskEvent compatibility; new event behavior must be additive.
- Use real evidence where it exists and label mock behavior explicitly.
- Describe security, permission, migration, and rollback implications.
- Update documentation and changelog entries when behavior changes.

Employee packages must satisfy the two-file standard and all required files documented in `AGENTS.md` and `docs/expert-package-spec.md`.

## Licensing of Contributions

CrewClaw is licensed under the [Apache License 2.0](LICENSE). By submitting a pull
request you agree that your contribution is licensed under those same terms, as stated
in Apache-2.0 §5 — inbound license equals outbound license. No separate CLA is required.

If a change adds a third-party dependency, state its license in the pull request and add
it to [`docs/DEPENDENCY-LICENSES.md`](docs/DEPENDENCY-LICENSES.md) when it is not plainly
permissive.

## Reporting Security Issues

Do not open a public issue for a suspected vulnerability or leaked credential. Follow `SECURITY.md`.
