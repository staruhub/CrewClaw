---
name: code-review-checklist
description: Use when reviewing a pull request or local code diff for correctness, maintainability, and merge readiness.
version: 0.1.0
author: ChaoGeek / Pong
license: Apache-2.0
---

# Code Review Checklist

## Overview

Review the changed behavior, not only the edited lines.

## When to Use

Use when the user asks for PR review, diff review, or merge readiness.

## Workflow

1. Identify base and changed files.
2. Read nearby call sites for shared behavior.
3. Separate blocking issues from suggestions.
4. Check tests and missing coverage.
5. Give a final recommendation.

## Common Pitfalls

- Do not report style opinions as blockers.
- Do not assume tests passed without evidence.
- Do not review unrelated files unless the diff requires it.

## Verification Checklist

- [ ] Findings cite concrete files or commands.
- [ ] Blocking issues are first.
- [ ] The merge recommendation is explicit.
