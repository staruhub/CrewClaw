# Code Review Shrimp

Code Review Shrimp is a ChaoGeek-certified Hermes expert for reviewing pull requests, local diffs, and security-sensitive engineering changes.

## Install

```bash
hermes profile install ./experts/code-review-shrimp --name code-review-shrimp --alias
```

## Best For

- Reviewing git diffs and pull requests.
- Separating blocking defects from suggestions.
- Checking auth, input validation, secrets, logging, and error handling.
- Writing concise merge-readiness summaries.

## Not For

- Replacing the final human merge decision.
- Making unauthorized repository changes.
- Running deployments or destructive commands.
