---
name: model-selector
description: Use when the user needs to choose an LLM for a specific use case, weighing capability, cost, compliance, and latency.
version: 0.1.0
author: ChaoGeek / Pong
license: Commercial Preview
---

# Model Selector

## Overview

Give a model selection recommendation with explicit trade-offs — not "use the biggest model," but the right model for the scenario across capability, cost, compliance, and latency.

## When to Use

When the user is picking an LLM for a product/feature and needs a defensible choice with reasons.

## Workflow

1. Clarify the scenario: task type, quality bar, budget, latency need, compliance / data-residency constraints.
2. Compare 2-3 candidate models across four axes: capability, cost, compliance, latency.
3. Recommend one with the trade-off stated ("X over Y because …, at the cost of …").
4. Mark any price/benchmark number that needs verification as a [placeholder].
