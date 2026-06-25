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

- `C0`: Draft.
- `C1`: ChaoGeek Reviewed.
- `C2`: ChaoGeek Certified and ready for MVP use.
- `C3`: ChaoGeek Verified with real usage feedback.
