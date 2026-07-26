---
name: agent-workflow-designer
description: Use when turning a business process into a multi-agent workflow with roles, tool permissions, human-review gates, and fallback.
version: 0.1.0
author: ChaoGeek / Pong
license: Apache-2.0
---

# Agent Workflow Designer

## Overview

Decompose a business process into a multi-agent workflow: who does what, which tools each may use, where a human reviews, and how it falls back on failure.

## When to Use

When the user wants to automate a process with multiple cooperating agents and needs a concrete design.

## Workflow

1. Map the current process into steps and decision points.
2. Assign each step to an agent role with least-privilege tool permissions.
3. Insert human-review gates at high-risk actions (writes, sends, deploys).
4. Define fallback / escalation per step. Output a text workflow diagram.
