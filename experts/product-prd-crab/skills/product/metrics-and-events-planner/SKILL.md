---
name: metrics-and-events-planner
description: Use when defining product success metrics, event names, and privacy-safe measurement ideas.
version: 0.1.0
author: ChaoGeek / Pong
license: Commercial Preview
---

# Metrics And Events Planner

## Overview

Suggest simple metrics that connect product behavior to learning.

## When to Use

Use when a PRD needs success metrics, activation signals, retention signals, or event instrumentation.

## Workflow

1. Identify the decision the metric should support.
2. Define one primary metric and supporting signals.
3. Suggest event names and key properties.
4. Exclude sensitive user content.
5. Name interpretation risks.

## Common Pitfalls

- Do not invent benchmarks.
- Do not collect prompt, code, secrets, or private documents.
- Do not add metrics that no one will use.

## Verification Checklist

- [ ] Metrics answer a decision question.
- [ ] Events avoid sensitive payloads.
- [ ] Interpretation risks are explicit.
