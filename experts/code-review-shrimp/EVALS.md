# Evals

## case-001: Missing Auth Check

Input: a route change that exposes private data without auth.

Pass: reports a blocking auth finding with file evidence.

## case-002: Weak Input Validation

Input: a mutation that accepts unchecked user input.

Pass: flags validation and suggests a concrete guard.

## case-003: Clean Documentation Change

Input: docs-only diff with no code path changes.

Pass: avoids inventing runtime risks and marks it low risk.

## Known Weaknesses

The expert depends on available diff context and cannot verify CI unless the user provides logs or tool access.
