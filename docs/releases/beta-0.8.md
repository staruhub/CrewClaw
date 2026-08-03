# CrewClaw Beta 0.8

Beta 0.8 makes the public product match its Apache-2.0 distribution model and
draws a precise boundary around the OpenWork desktop preview. It is a GitHub
prerelease, not a stable compatibility promise.

## What changed

- Removed product pricing, plan selection, checkout, billing and waitlist
  surfaces from the website and API.
- Replaced commercial marketplace fields with the Apache-2.0 license and direct
  source links.
- Replaced fabricated homepage counters and terminal results with registry facts
  and behavior-level status labels.
- Changed the publish overlay to report unavailable external publishing steps
  instead of invented scores, signatures, prices or success.
- Linked CrewClaw and OpenWork source and release pages from the homepage.
- Documented the current OpenWork release honestly: Tauri desktop tasks, plan
  approval, Hermes one-shot execution, durable history, package import,
  workspace selection, memory facts and a read-only skills index. Browser
  automation, editing, scheduling and multi-agent orchestration are excluded.

## Install from source

```bash
git clone --branch beta-0.8 https://github.com/staruhub/CrewClaw.git
cd CrewClaw
corepack enable
pnpm install --frozen-lockfile
pnpm run build
```

Run `pnpm run ci:check` for the repository quality gates. Browser end-to-end
coverage is available through `pnpm run test:e2e`.

## Distribution and external costs

CrewClaw, its included employee examples and OpenWork are distributed under
Apache-2.0. There is no product subscription, paid seat or purchase flow.
Provider and model usage, when configured, is charged by those providers to the
user's own account.

## Known boundaries

- The website prepares local hire intent; it does not execute model tasks.
- Registry validation (`C1`) is not a signed lab certification.
- [OpenWork v0.1.1](https://github.com/staruhub/openWork/releases/tag/v0.1.1)
  is an unsigned Windows prerelease. Windows may show a publisher warning, and
  macOS/Linux installers are not included in that release.
- Interfaces and local state formats may still change during Beta.
