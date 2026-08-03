# Releasing CrewClaw

This checklist complements the evidence gates in `docs/prd_v0.20.md`.

## 1. Legal and Privacy

- Confirm the repository and `experts/**` remain covered by Apache-2.0.
- Complete a third-party license and notice review.
- Scan the full reachable Git history for credentials and private user/session data.
- Rewrite history only with an approved backup, coordination plan, and force-push window.

## 2. Source Snapshot

- Start from the actual `crewhire` Git root.
- Require a clean working tree and reviewed staged snapshot.
- Align README, product milestone, CLI version, changelog, and release notes.
- Record the release commit and create a signed or annotated tag.

## 3. Verification

```bash
pnpm install --frozen-lockfile
pnpm run ci:check
pnpm run test:e2e
```

Complete the provider-verified Eval, least-privilege MCP positive and negative probes, Dream activation and rollback, release-binary hash, and five-screen deployment evidence required by the PRD.

## 4. GitHub Controls

- Require pull requests and passing CI on the default branch.
- Enable Dependabot alerts, secret scanning, private vulnerability reporting, and code scanning where available.
- Keep Actions permissions read-only by default.
- Pin third-party Actions to full commit SHAs.

## 5. Release

- Build artifacts from the release commit, not a dirty working tree.
- Record artifact hashes and platform information.
- Publish a GitHub Release with installation, upgrade, rollback, known-limit, and license notes.
- Verify every download and quick-start command from a fresh clone or machine.
