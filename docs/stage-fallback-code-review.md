# Stage fallback — live code review (real run, saved 2026-05-30)

Command:

```
crew run code-review-shrimp "review packages/runtime/run.mjs for merge readiness"
```

---

Code Review Shrimp · model anthropic/claude-opus-4.8 · 4 skills · live

# Code Review: packages/runtime/run.mjs

Scope: single new file, reviewed as provided. No test files or call sites were included, so I note missing-evidence items where relevant.

## Blocking Issues

**B1 — `.env.local` parser leaks trailing quotes and inline comments**
`packages/runtime/run.mjs:23` — the regex `(.*)` captures the raw remainder. Values written as `ZENMUX_API_KEY="sk-..."` or `KEY=value # comment` get parsed literally, so the API key includes quotes/comment text. The `Authorization: Bearer ${apiKey}` header then sends a malformed token and every request fails with a confusing 401. Strip surrounding quotes and trailing comments, or document that quotes are unsupported.

**B2 — Path traversal via `agentId`**
`resolveProfileDir` (`:34`) interpolates `agentId` straight into `join(ROOT, base, agentId)`. A value like `../../etc` or an absolute path escapes the intended `agents/`/`experts/` roots. Since this reads `SOUL.md`, `config.yaml`, and walks `skills/**`, a crafted `agentId` can read arbitrary `SOUL.md`-named files and load their content into the system prompt. Validate `agentId` against a strict allowlist pattern (e.g. `^[a-z0-9-]+$`) and reject path separators before use.

**B3 — `response.text()` consumed before stream check can misreport**
`:96` — when `response.ok` is true but `response.body` is null, the code calls `response.text()` in the error path. That is fine, but the bigger issue: `temperature` may be `undefined` is not the problem here — the real one is that a non-OK response with a streamed error body is read once, which is correct. **Downgrade:** on reflection this is acceptable. Removing from blocking. (See S4 for the genuine concern.)

## Suggestions (non-blocking)

**S1 — SSE buffer can split multi-byte and multi-line frames**
`:103` — splitting on `\n` is mostly fine because `TextDecoder({stream:true})` handles byte boundaries, but SSE frames are delimited by blank lines and a single `data:` event can span multiple lines. Most OpenAI-compatible endpoints send one JSON per `data:` line, so this works in practice, but it is fragile if ZenMux ever multi-lines a payload. Consider splitting on `\n\n` for event boundaries.

**S2 — No request timeout / abort**
`streamCompletion` has no `AbortController`. A hung upstream stalls the process indefinitely. Add a timeout and abort signal.

**S3 — `readdir`/`stat` walk lacks error handling and symlink guard**
`collectSkills` (`:48`) will throw uncaught if a skill dir is unreadable, and follows symlinks via `stat`, allowing skill content to be pulled from outside the profile dir. Use `lstat` to skip symlinks and wrap walk in try/catch.

**S4 — `error.message` access on non-Error throws**
`:178` main-level handler guards with `error?.message ?? error`, but `:172` inner catch does `error.message` directly. If a non-Error is thrown, this throws again. Minor; mirror the guard used at the bottom.

**S5 — Config validation is silent**
`:160` — non-numeric `temperature` or non-string `model.default` are silently ignored. Fine for a demo, but a malformed config gives no feedback. Consider a warning.

**S6 — Secret exposure in error detail**
`:97` — `detail.slice(0,300)` from the endpoint is printed to stderr. Low risk, but upstream error bodies occasionally echo request context. Acceptable given local-CLI scope.

## Verification Notes

- No tests were provided; I cannot confirm any behavior was exercised. Claim of "every token comes from the model" is consistent with the streaming code but unverified by a run.
- I did not execute the file. Findings are from static reading only.

## Merge Recommendation

**Merge after fixes.** Resolve B1 (env parsing) and B2 (path traversal) before merge — both cause real failures or read arbitrary files. S1–S6 can land as follow-ups. I am not the merge authority; a human should confirm the env-format assumption and the `agentId` allowlist before approving.

Want me to draft the `agentId` validation and the env-parser fix as concrete patches?
