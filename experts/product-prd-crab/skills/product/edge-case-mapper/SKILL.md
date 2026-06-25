---
name: edge-case-mapper
description: Use when mapping edge cases, failure modes, and exception flows for a product requirement.
version: 0.1.0
author: ChaoGeek / Pong
license: Commercial Preview
---

# Edge Case Mapper

## Overview

Make hidden product paths visible before implementation.

## When to Use

Use when a requirement has a happy path but missing error, empty, permission, retry, or boundary states.

## Workflow

1. Map the main user journey.
2. Add empty, loading, error, and permission states.
3. Add abuse, duplicate, and rollback cases.
4. Identify operational ownership.
5. Convert important cases into acceptance criteria.

## Common Pitfalls

- Do not list impossible edge cases just to look thorough.
- Do not ignore privacy or permission states.
- Do not mix implementation details with user-visible behavior.

## Verification Checklist

- [ ] Core journey and failure paths are covered.
- [ ] Edge cases are tied to acceptance criteria.
- [ ] High-risk unknowns are called out.
