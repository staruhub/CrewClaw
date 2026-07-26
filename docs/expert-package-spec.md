# ChaoGeek Hermes Expert Package Spec

## Required Files

Each installable expert profile must include:

- `distribution.yaml`
- `README.md`
- `SOUL.md`
- `config.yaml`
- `mcp.json`
- `.env.EXAMPLE`
- `CERTIFICATION.md`
- `EXAMPLES.md`
- `EVALS.md`
- `CHANGELOG.md`
- `skills/**/SKILL.md`

## Distribution Rules

- `distribution.yaml` must define `name`, `version`, `description`, `hermes_requires`, `author`, and `license`.
- Names must use lowercase kebab-case.
- Versions must use SemVer.
- Secrets, real `.env` files, auth files, memories, sessions, logs, workspaces, and state DBs are forbidden.
- MCP servers must declare a tool allowlist or denylist when configured.
- Skill files must include YAML frontmatter with `name` and a `description` beginning with `Use when`.

## Certification Levels

- `C0`: Draft package; no validation claim.
- `C1`: Package Validated; structure and safety rules pass, but the employee is not certified.
- `C2`: Lab Certified by a current signed, non-MOCK Credential bound to the package and active memory.
- `C3`: Field Proven by independently verifiable real-usage evidence in addition to C2.

See [`good-employee-standard-v1.md`](good-employee-standard-v1.md). A package's own self-tests or text cannot promote its level.
