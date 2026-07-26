---
name: security-risk-scan
description: Use when reviewing a code change for auth, input validation, secrets, permissions, or unsafe side effects.
version: 0.1.0
author: ChaoGeek / Pong
license: Apache-2.0
---

# Security Risk Scan

## Overview

Find practical security risks introduced by a change.

## When to Use

Use when a PR touches auth, user input, network calls, file access, tokens, payments, admin actions, or deployment logic.

## Workflow

1. Map trust boundaries.
2. Check authentication and authorization.
3. Check validation and output encoding.
4. Search for secret leakage.
5. Identify destructive or irreversible actions.

## Common Pitfalls

- Do not claim exploitability without evidence.
- Do not request tokens for read-only review.
- Do not ignore logs that may leak user data.

## Verification Checklist

- [ ] Auth and input validation were considered.
- [ ] Secret patterns were checked.
- [ ] High-risk actions require human confirmation.
