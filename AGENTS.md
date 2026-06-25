# AGENTS.md

## Project

This repo builds CrewClaw by ChaoGeek: a Vite website, static expert registry, Hermes expert profile distributions, a local CLI wrapper, and a validator.

## Boundaries

- Hermes Agent is the runtime. Do not fork or modify Hermes internals.
- Do not build Cursor integration for MVP.
- Do not write directly to `~/.hermes`; use official `hermes profile` commands.
- Do not commit `.env`, `auth.json`, memories, sessions, logs, state DBs, workspaces, or user data.
- P0 installable experts are only `code-review-shrimp` and `product-prd-crab`.
- `hermes-onboarding-conch` and `docs-octopus` are Coming Soon unless explicitly requested.

## Commands

- `pnpm run check`
- `pnpm run lint`
- `pnpm test`
- `pnpm run build`
- `pnpm run validate:all-experts`
- `pnpm run test:e2e`
- `pnpm run crewclaw list`

## Expert Package Rules

Each available expert must include `distribution.yaml`, `README.md`, `SOUL.md`, `config.yaml`, `mcp.json`, `.env.EXAMPLE`, `CERTIFICATION.md`, `EXAMPLES.md`, `EVALS.md`, `CHANGELOG.md`, and at least one `skills/**/SKILL.md`.

## Done Means

All checks pass, validator catches unsafe packages, CLI tests use mocked process execution, website builds, and local Hermes smoke testing is recorded when available.
