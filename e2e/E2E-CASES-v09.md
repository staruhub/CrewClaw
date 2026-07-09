# CrewClaw E2E Test-Case Catalog — v0.9 + recently-fixed regressions

Scope: end-to-end scenarios for the digital-employee flow (chat → workbench), covering the
v0.9 visual redesign, the M5 discoverability features, and the confirmed-bug regressions
recently fixed in `packages/runtime/tui/jsonl-bridge.mjs` and `packages/runtime/tui/route.mjs`.

## Why three layers

The product is a Rust/Ratatui TUI whose engine is a Node JSONL bridge
(`packages/runtime/tui/jsonl-bridge.mjs`): the front-end writes user lines to the engine's
stdin, the engine emits `TaskEvent` JSONL on stdout, and the front-end reduces that stream into
`AppState` and renders. Playwright cannot drive a terminal, so:

| Layer | Runner | What it can observe | Best for |
|---|---|---|---|
| **bridge-node** | `packages/runtime/__tests__/*.test.mjs` via `node __tests__/run-all.mjs` (`CREW_MOCK=1`) | The emitted `TaskEvent` JSONL — the exact wire the front-end reduces | Engine behavior: routing, task lifecycle, preflight, deliverables, approval |
| **rust-testbackend** | `cargo test` in `crates/crewclaw-cli` (unit tests in `workbench/ui.rs`, `state.rs`) | Rendered Ratatui frame lines + reduced `AppState` | Front-end rendering: banner, scrollbar, gutters, hints, layout |
| **playwright-web** | `e2e/*.spec.ts` (Playwright) | The **website** DOM (`task-run-workbench`, install page) — NOT the TUI | Web workbench + install flow |

The confirmed-bug regressions live in the engine, so they run at **bridge-node** — that is where
"green but wrong" bugs (a turn silently dropped, a blocked task overwritten to done) are caught.

---

## A. Confirmed-bug regressions (recently fixed) — bridge-node

These are implemented and runnable in `packages/runtime/__tests__/e2e-tui-flow.test.mjs`.

| id | scenario | steps (inputs) | expected observable events / state | layer |
|---|---|---|---|---|
| **E2E-01** | Attachment-only message runs (not silently dropped) | One `user.message` with `data.text=""` and `data.parts=[{type:"image",…}]` | `task.started` IS emitted (title = `（附件消息）`); the model turn runs; turn settles to `task.completed`. NOT a no-op. | bridge-node |
| **E2E-02** | Preflight-blocked task blocks honestly | `给我一份最新大模型发布的研究报告` (employee_task + needsSearch) with only the `ddg` scrape backend (no `TAVILY_API_KEY`) | `tool.preflight_checked{status:"missing_key"}` then `task.blocked`; `decision.blocked=true`; **NO `task.completed`** anywhere in the turn (blocked is terminal — reducer must not be overwritten to done). | bridge-node |
| **E2E-03** | Plain chat turn settles to idle | `你好` (employee_chat, light greeting); model returns a short reply | `task.started` → model runs → `task.completed`. **NO** `task.blocked`; **NO** `outcome.checked{valid:false}`; **NO** `缺少交付物` / `no_artifact` anywhere. No-Artifact-No-Done is a TASK rule, not a chat rule. | bridge-node |
| **E2E-04** | Deliverable + attachment still upgrades to a TaskRun | `user.message` with `text="帮我把这张图整理成一份分析报告"` AND an image part; model returns a long structured report | `task.upgraded_from_chat` emitted (NOT downgraded to chat by the attachment path); `artifact.created`; `approval.requested`; **NO premature `task.completed`** (deliverable held for accept). Only ambiguous/out_of_scope attachment turns get forced to chat. | bridge-node |
| **E2E-05** | Multi-line paste is ONE message | One JSONL frame `user.message` whose `data.text` contains embedded `\n` (`第一行\n第二行\n第三行`) | Exactly **one** `task.started` for the whole paste — not one turn per physical line. | bridge-node |

### Supporting live-behavior cases (already covered by sibling bridge tests)

| id | scenario | steps | expected | layer | existing coverage |
|---|---|---|---|---|---|
| E2E-06 | Deliverable → PendingActions → accept across the process boundary | deliverable request; after it finishes, send `1` | `pending.actions` with `[1] accept`; `artifact.created`; then the `1` line yields `artifact.updated{patch.status:"accepted"}` | bridge-node | `tui-jsonl-actions.test.mjs` |
| E2E-07 | L2 approval decision arrives mid-turn | task triggers `confirm()`; next line is `a`/`d` | `approval.required` then `approval.resolved{decision}` — decision read WHILE the agent is blocked | bridge-node | `jsonl-bridge` confirm path |
| E2E-08 | Slash command is engine-executed, never a task | `/help`, `/clear` | `command.output` emitted; NO `task.started`; `/clear` empties shared history | bridge-node | `commands-smoke.mjs`, `tui-repl.test.mjs` |
| E2E-09 | Clean TaskEvent JSONL for a formal task | scripted task sink | ordered `session.ready → task.started → plan.created → tool.preflight_checked → token.delta → tool.* → artifact.created → outcome.checked → task.completed`, no ANSI in JSONL | bridge-node | `tui-task-jsonl.test.mjs` |

---

## B. v0.9 visual redesign + M5 discoverability — rust-testbackend

These assert on the rendered Ratatui frame / reduced `AppState`, run under `cargo test` in
`crates/crewclaw-cli`. (Owned by the front-end; anchors below are existing/target unit tests in
`crates/crewclaw-cli/src/workbench/ui.rs`.)

| id | scenario | steps (state) | expected observable frame / state | layer | anchor |
|---|---|---|---|---|---|
| **E2E-10** | Empty-state hint: first-screen banner present on empty session | Fresh `AppState`, no messages | Frame's message stream leads with the ASCII banner + tagline + employee name·role (empty-state discoverability hint) | rust-testbackend | `banner_present_on_empty_then_scrolls_out_with_conversation` (AC-VIS-001) |
| **E2E-11** | Banner scrolls out as conversation grows | Push several turns | Banner stays at layout top and scrolls out of the viewport with content — it is stream content, not a fixed header | rust-testbackend | AC-VIS-001 |
| **E2E-12** | Scroll-back indicator appears when detached from bottom | Scroll up (negative delta) so `follow=false` | A scrollbar renders on the right edge; a "more below / scroll-back" affordance is visible while detached (M5) | rust-testbackend | scrollbar path (`ui.rs` ~L220), `state.rs` `scroll_max` |
| **E2E-13** | Reaching the bottom restores follow | Scroll down until at bottom | `follow` is restored to `true`; scroll indicator hidden; new events resume auto-stick to bottom | rust-testbackend | `state.rs` M5 scroll reducer |
| **E2E-14** | Default input hint present when idle, replaced by spinner when busy | Toggle busy state | Idle: default hint line shown. Busy: spinner frame + "生成中" shown, default hint gone. Done: hint restored. | rust-testbackend | `ui.rs` busy/idle hint tests (~L1947–1960) |
| **E2E-15** | Pending-action hint line renders selectable digits | State with `pending_actions` | Hint line shows `[1] 接受 [2] 修订 [3] 打开位置` style affordance (digit discoverability) | rust-testbackend | `pending_action_hint_line` (`ui.rs` ~L1172) |
| **E2E-16** | User vs assistant message gutters | Push a user msg + an assistant msg | User message carries the brand-color left gutter (`▏`); assistant message renders flush with no header (v0.9 direct layout) | rust-testbackend | `ui.rs` gutter render tests |
| **E2E-17** | Narrow-viewport render does not panic | Resize to extreme narrow width | Banner + scrollbar render without panic (clamp holds) | rust-testbackend | AC-SCR-003 (`ui.rs` ~L2039) |
| **E2E-18** | Input auto-focus on typing (input-focus bug) | Send a `Char` event with input unfocused | Typing any char focuses the input (catch-all Char arm); digit still hits `PendingAction` when a pending action exists | rust-testbackend | `input.rs` focus reducer |

---

## C. Website workbench + install — playwright-web

Existing specs; listed for completeness (these drive the DOM, not the TUI).

| id | scenario | layer | spec |
|---|---|---|---|
| E2E-19 | Task-run workbench renders plan/timeline/artifacts/proofpack | playwright-web | `e2e/task-run-workbench.spec.ts` |
| E2E-20 | Install / onboarding page flow | playwright-web | `e2e/website-install.spec.ts` |

---

## How to run

- **bridge-node** (this catalog's runnable subset):
  `cd packages/runtime && node __tests__/run-all.mjs`
  (runs every `__tests__/*.test.mjs` under `CREW_MOCK=1`; `e2e-tui-flow.test.mjs` is auto-discovered).
  To run just the new file: `cd packages/runtime && CREW_MOCK=1 node __tests__/e2e-tui-flow.test.mjs`
- **rust-testbackend**: `cargo test -p crewclaw-cli` (workbench unit tests).
- **playwright-web**: the repo's Playwright command against `e2e/*.spec.ts`.
