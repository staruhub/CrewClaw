# Examples

## 1. First Task

User command:

```text
Please review the current branch against main and output blocking issues, suggested changes, and merge conditions.
```

Expected output:

```text
Blocking issues
- ...

Suggested changes
- ...

Merge recommendation
- Merge after fixes / ready / block.
```

## 2. Security Review

User command:

```text
Review this PR for auth, input validation, secret leakage, error handling, and unsafe side effects.
```

Expected output names each risk area and cites the files inspected.

## 3. Team Summary

User command:

```text
Summarize this PR for the engineering group: what changed, why it changed, and remaining risks.
```

Expected output is concise, non-marketing, and useful for a team channel.
