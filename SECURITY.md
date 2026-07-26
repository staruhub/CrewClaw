# Security Policy

## Supported Versions

CrewClaw has not published a stable release. Security fixes currently target the default branch and the active release candidate only.

## Reporting a Vulnerability

Do not report vulnerabilities, leaked credentials, or private user data in a public issue.

GitHub Private Vulnerability Reporting is not enabled for this repository as of
July 24, 2026. Before publishing a stable release, a repository administrator
must enable it under **Settings → Security → Advanced Security → Private
vulnerability reporting**.

After it is enabled, use:

<https://github.com/staruhub/CrewClaw/security/advisories/new>

Until then, use an existing private channel with a maintainer. If you do not
have one, open a public issue containing no vulnerability details and ask the
maintainer to establish a private channel.

A report should include:

- affected component and revision;
- reproduction steps or a minimal proof of concept;
- expected and observed impact;
- suggested mitigation, if known;
- whether credentials or user data may have been exposed.

If a credential may be live, revoke or rotate it immediately. Removing it from the latest file is insufficient when it exists in Git history.

## Disclosure

Please allow maintainers reasonable time to validate and remediate the issue before public disclosure. Confirmed vulnerabilities will be documented through a GitHub Security Advisory or release notes.
