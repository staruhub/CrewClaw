# TUI Workbench v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn CrewClaw interactive employee work into a full-screen Ratatui Workbench backed by structured TaskEvent JSONL and verified degradation for non-TTY usage.

**Architecture:** Keep the runtime in Node and the TUI shell in Rust. The Node runtime emits structured `TaskEvent` JSONL when `CREW_TUI=ratatui`; the Rust workbench owns terminal mode, reduces events into `AppState`, and renders responsive panels every frame.

**Tech Stack:** Rust 2024, Ratatui 0.30, Crossterm 0.29, `unicode-width`, Node.js runtime JSONL bridge, Vitest/Node tests, Cargo tests.

---

## File Structure

- `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`: authoritative TUI Workbench behavior spec.
- `crates/crewclaw-cli/src/workbench/mod.rs`: terminal lifecycle, TTY/plain branch, event loop, child runtime bridge, input-to-runtime routing.
- `crates/crewclaw-cli/src/workbench/state.rs`: reducer and durable UI state.
- `crates/crewclaw-cli/src/workbench/ui.rs`: Ratatui frame layout and widgets.
- `crates/crewclaw-cli/src/workbench/protocol.rs`: `TaskEvent` protocol variants and deserialization.
- `packages/runtime/run.mjs`: runtime entry that emits clean JSONL in Ratatui mode.
- `packages/runtime/tui/*.mjs`: Node-side event helpers.

## Task 1: Lock Spec and Plan Artifacts

**Files:**

- Create: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`
- Create: `docs/superpowers/plans/2026-06-30-tui-workbench-v1.md`

- [x] **Step 1: Write the TUI Workbench v1 spec**

Capture the 12 hard requirements from the pasted brief: alternate screen, resize redraw, keyboard completeness, mouse optionality, color-independent status, CJK width handling, plain/JSON degradation, event timeline, artifact panel, Inspect/debug split, pending action routing, and tool truth.

- [x] **Step 2: Write this implementation plan**

Create a task-by-task plan with exact files, commands, and verification gates.

- [x] **Step 3: Review spec for unfinished markers and contradictions**

Run:

```bash
rg -n "[T]BD|[T]ODO|[Mm]a[y]be|[Ll]a[t]er" docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md docs/superpowers/plans/2026-06-30-tui-workbench-v1.md
```

Expected: no matches.

## Task 2: Verify Existing Workbench State Coverage

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/state.rs`
- Test: `crates/crewclaw-cli/src/workbench/ui.rs`
- Test: `crates/crewclaw-cli/src/workbench/mod.rs`

- [ ] **Step 1: Run current Rust workbench tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml workbench
```

Expected: all workbench-focused tests pass.

- [ ] **Step 2: Confirm spec coverage from tests**

Map current tests to spec requirements:

- `transcript_jsonl_has_no_ansi_and_includes_symbol_status` covers TUI-005 and TUI-007.
- `task_event_line_parser_skips_blanks_and_reports_bad_json` covers JSONL parse resilience.
- `pending_action_digit_routes_only_when_unfocused_and_matching` covers TUI-011.
- `pending_action_digit_does_not_route_while_approval_is_active` covers TUI-011 approval precedence.
- `research_turn_reduces_to_timeline_answer_and_tools` covers TUI-008 and state reduction.
- `v06_events_capture_pending_memory_and_artifact_path` covers TUI-009 and memory state.
- `outcome_checked_pushes_a_verdict_line` covers outcome visibility.
- `truncates_cjk_by_display_width_not_char_count` covers TUI-006.
- `layout_kind_uses_spec_breakpoints` covers TUI-002 breakpoints.
- `status_symbol_carries_semantics_without_color` covers TUI-005.
- `render_shows_approval_modal_over_normal_layout` covers approval UI.

- [ ] **Step 3: Identify remaining automated coverage gaps**

If the test run shows no direct coverage for a requirement, add a failing test before changing production code.

## Task 3: Add Missing Regression Tests Before Code Changes

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/ui.rs`
- Test: `crates/crewclaw-cli/src/workbench/state.rs`
- Test: `crates/crewclaw-cli/src/workbench/mod.rs`

- [x] **Step 1: Add a failing test for artifact status rendering**

Add a test that creates artifacts with `ready`, `needs_review`, `accepted`, `rejected`, and `exported` statuses and asserts the rendered buffer contains both symbol and artifact name.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml render_shows_artifact_statuses_with_symbols
```

Expected before implementation: fail if any status is rendered with only color or an ambiguous symbol.

- [x] **Step 2: Add a failing test for Inspect debug visibility**

Add `render_inspect_shows_recent_debug_details` to prove raw debug details are available in the Inspect panel instead of being treated as the main timeline content.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml render_inspect_shows_recent_debug_details
```

Expected before implementation: FAIL because Inspect does not render a Debug section.

- [x] **Step 2a: Implement Inspect Debug section**

Render the most recent debug lines in Inspect under a `Debug` heading. Keep Timeline based on event summaries, not raw debug strings.

- [ ] **Step 3: Add a failing test for non-TTY transcript shape if needed**

Extend the transcript test to assert the JSON has `type`, `event`, `status`, `symbol`, `label`, and `detail`, and contains no `\u{1b}`.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml transcript_jsonl_has_no_ansi_and_includes_symbol_status
```

Expected before implementation: fail if transcript output is missing required fields.

## Task 4: Implement Only the Gaps

**Files:**

- Modify: `crates/crewclaw-cli/src/workbench/state.rs`
- Modify: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `packages/runtime/run.mjs`

- [ ] **Step 1: Run each failing test from Task 3 and verify it fails for the intended reason**

Use the exact commands from Task 3. Confirm failures are missing behavior, not syntax errors.

- [ ] **Step 2: Implement minimal Rust changes**

Change only the reducer, renderer, or event loop behavior required to pass the failing tests. Preserve the existing protocol and layout boundaries.

- [ ] **Step 3: Implement minimal Node runtime changes if Ratatui JSONL mode is incomplete**

Only touch `packages/runtime/run.mjs` if the Rust bridge cannot receive clean events or user input. Keep stdout pure JSONL in `CREW_TUI=ratatui`.

- [ ] **Step 4: Re-run targeted tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml workbench
```

Expected: all workbench tests pass.

## Task 4A: Enforce No Artifact, No Done

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/state.rs`
- Test: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `crates/crewclaw-cli/src/workbench/state.rs`
- Modify: `crates/crewclaw-cli/src/workbench/ui.rs`

- [x] **Step 1: Write the failing reducer test**

Add `completed_task_without_artifact_is_not_done` to prove `task.completed` cannot set `AppState.status` or `Task.status` to `done` when no artifacts exist.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml completed_task_without_artifact_is_not_done
```

Expected before implementation: FAIL with `left: "done" right: "needs_artifact"`.

- [x] **Step 2: Implement the reducer guard**

When `task.completed` arrives and `state.artifacts` is empty, set task/app status to `needs_artifact` and push a warning timeline entry labeled `缺少交付物`.

- [x] **Step 3: Write the failing UI status mapping assertion**

Extend `status_symbol_carries_semantics_without_color` so `needs_artifact` must render as warning semantics instead of an unknown gray state.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml status_symbol_carries_semantics_without_color
```

Expected before implementation: FAIL with `left: Gray right: Yellow`.

- [x] **Step 4: Implement the status mapping**

Map `needs_artifact` to `!` and warning color.

- [x] **Step 5: Re-run targeted tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml completed_task_without_artifact_is_not_done
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml status_symbol_carries_semantics_without_color
```

Expected: both pass.

## Task 4B: Complete Keyboard Cancel and Paste Input

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Write the failing Ctrl+G cancel test**

Add `ctrl_g_cancels_focused_input_and_clears_buffer` to prove local input cancellation clears the buffer and removes input focus.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml ctrl_g_cancels_focused_input_and_clears_buffer
```

Expected before implementation: FAIL because `cancel_current_action` does not exist.

- [x] **Step 2: Implement Ctrl+G routing**

Add `cancel_current_action` and route `Ctrl+G` to clear input, close overlays, and continue without quitting the workbench.

- [x] **Step 3: Write the failing paste test**

Add `paste_appends_only_when_input_is_focused` to prove pasted text appends only to focused input and does not mutate input while browsing panels.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml paste_appends_only_when_input_is_focused
```

Expected before implementation: FAIL because `append_paste_to_input` does not exist.

- [x] **Step 4: Implement paste handling**

Handle Crossterm `Event::Paste(text)` through `append_paste_to_input`, and enable/disable bracketed paste with the terminal guard so paste events are emitted in TTY mode and terminal state is restored on exit.

- [x] **Step 5: Update the spec**

Add Ctrl+G to TUI-003 and add TUI-013 for bracketed paste lifecycle and focused-input paste behavior.

## Task 4C: Make `crew chat` Enter Workbench by Default on TTY

**Files:**

- Test: `crates/crewclaw-cli/src/main.rs`
- Modify: `crates/crewclaw-cli/src/main.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Write the failing routing tests**

Add `chat_defaults_to_ratatui_on_tty_unless_plain_is_requested` to prove `crew chat <employee>` uses Ratatui on TTY by default, `--tui`/`--ratatui` also request it, `--plain` opts out, and non-TTY stdout degrades to plain runtime output.

Add `node_runtime_args_strip_rust_tui_control_flags` to prove `--plain`, `--tui`, and `--ratatui` are not forwarded to the Node runtime.

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml chat_defaults_to_ratatui_on_tty_unless_plain_is_requested
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml node_runtime_args_strip_rust_tui_control_flags
```

Expected before implementation: FAIL because `should_use_ratatui_chat` and `node_runtime_forward_args` do not exist.

- [x] **Step 2: Implement the route helpers**

Add `should_use_ratatui_chat(args, stdout_is_tty)` and `node_runtime_forward_args(args)`. `--plain` wins over TUI routing. Non-TTY stdout always degrades to Node runtime output.

- [x] **Step 3: Wire `run_agent_live`**

Use the helper in `run_agent_live` so `crew chat <employee>` enters the Ratatui workbench by default on TTY while preserving plain Node runtime forwarding for `--plain`, non-TTY, and `run`.

- [x] **Step 4: Update help and spec**

Document `--plain`, `--tui`, and `--ratatui` in CLI help and clarify that current default Workbench coverage is for `crew chat`; `crew run --task` remains a future runtime-event integration.

## Task 4D: Make Focused Input Cursor-aware

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/mod.rs`
- Test: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Add cursor-aware input buffer tests**

Add `input_buffer_moves_and_deletes_on_char_boundaries` to prove Left/Right/Home/End/Delete/Backspace operate on UTF-8 character boundaries, including CJK text.

- [x] **Step 2: Route focused input through `InputBuffer`**

Replace raw `String` input mutation with an `InputBuffer` that tracks byte cursor position, inserts paste at the cursor, submits via `take()`, and clears cursor state on cancel.

- [x] **Step 3: Preserve text input while focused**

Add `input_focus_treats_quit_letters_as_text` so ordinary command characters such as `q` remain editable text while the input box is focused.

- [x] **Step 4: Render a real CJK-aware cursor**

Add `render_places_cursor_at_cjk_aware_input_position` and render the terminal cursor at the focused input position using display width instead of byte length.

## Task 4E: Route Manifest Task Runs Through Workbench

**Files:**

- Test: `crates/crewclaw-cli/src/main.rs`
- Test: `packages/runtime/__tests__/tui-task-jsonl.test.mjs`
- Create: `packages/runtime/tui/task-jsonl.mjs`
- Modify: `crates/crewclaw-cli/src/main.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `packages/runtime/run.mjs`

- [x] **Step 1: Add a failing Rust routing test**

Add `run_task_defaults_to_ratatui_on_tty_unless_plain_is_requested` to prove `crew run <employee> --task <id>` selects Workbench on TTY, while free-form one-shot `crew run <employee> "<task>"`, `--plain`, and non-TTY stdout stay on legacy/plain output.

- [x] **Step 2: Add a Node task JSONL contract test**

Add `tui-task-jsonl.test.mjs` to prove task-mode Workbench output is clean TaskEvent JSONL for `session.ready`, `task.started`, `plan.created`, tool preflight, deltas, tool events, `artifact.created`, `outcome.checked`, and `task.completed`.

- [x] **Step 3: Implement Rust task routing**

Rename the routing helper to `should_use_ratatui_workbench`, route `chat` and `run --task` on TTY, keep `--plain` and non-TTY as plain runtime output, and pass the full Node runtime arguments into `run_workbench_live`.

- [x] **Step 4: Implement Node task JSONL sink**

Create `packages/runtime/tui/task-jsonl.mjs` and wire `runTaskMode` so `CREW_TUI=ratatui` emits TaskEvents instead of ANSI stdout while preserving legacy task output outside Ratatui mode.

- [ ] **Step 5: Verify Node contract test**

Run:

```bash
node packages/runtime/__tests__/tui-task-jsonl.test.mjs
```

Expected: test passes once the local pnpm dependency environment is available.

## Task 4F: Add Focused Input History

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Add failing input history tests**

Add `input_buffer_records_history_and_restores_draft` to prove submitted input is recorded, `Up` walks backward through prior commands, `Down` walks forward, and the pre-history draft is restored at the end.

Add `focused_input_up_down_navigates_history_instead_of_scrolling` to prove focused `Up` / `Down` navigates input history instead of scrolling the active panel.

- [x] **Step 2: Implement input history in `InputBuffer`**

Store submitted non-empty inputs, preserve a draft while navigating history, and reset navigation when the buffer is edited or cancelled.

- [x] **Step 3: Route focused `Up` / `Down` through history**

Keep panel scrolling for unfocused input, but use focused `Up` / `Down` for command history navigation.

- [x] **Step 4: Re-run targeted tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml history
```

Expected: both input history tests pass.

## Task 4G: Add Multiline Focused Input

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/mod.rs`
- Test: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `crates/crewclaw-cli/src/workbench/ui.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Add failing multiline input tests**

Add `alt_enter_inserts_newline_and_plain_enter_submits_multiline_input` to prove `Alt+Enter` inserts a newline while plain `Enter` submits the full multiline buffer.

Add `render_places_cursor_on_multiline_input_row` to prove multiline input renders separate rows and positions the cursor on the active row with display-width-aware CJK measurement.

- [x] **Step 2: Implement multiline input routing**

Route focused `Alt+Enter` to insert `\n`, while preserving plain `Enter` as submit and preserving existing history/cancel semantics.

- [x] **Step 3: Implement multiline bottom rendering**

Grow the bottom input area up to four visible input lines, render continuation lines aligned under the prompt, and compute cursor row/column from the current byte cursor.

- [x] **Step 4: Re-run targeted tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml multiline
```

Expected: both multiline tests pass.

## Task 4H: Capture Runtime stderr Into Inspect

**Files:**

- Test: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `crates/crewclaw-cli/src/workbench/mod.rs`
- Modify: `docs/superpowers/specs/2026-06-30-tui-workbench-v1-design.md`

- [x] **Step 1: Add failing stderr debug reader test**

Add `stderr_debug_reader_wraps_lines_for_inspect` to prove runtime stderr text lines are wrapped as debug messages for Inspect instead of being parsed as TaskEvent JSONL or written directly to the terminal.

- [x] **Step 2: Pipe live runtime stderr**

Change `run_workbench_live` from inherited stderr to piped stderr, spawn a debug-line reader, and drain it during the live Workbench loop.

- [x] **Step 3: Keep stdout protocol strict**

Leave stdout on the existing TaskEvent JSONL reader so runtime events and debug text stay separated.

- [x] **Step 4: Re-run targeted test**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml stderr_debug_reader_wraps_lines_for_inspect
```

Expected: stderr debug reader test passes.

## Task 5: Full Verification

**Files:**

- Verify only; no production edits expected.

- [ ] **Step 1: Run Rust tests**

Run:

```bash
cargo test --manifest-path crates/crewclaw-cli/Cargo.toml
```

Expected: all Rust CLI tests pass.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
pnpm run check
```

Expected: TypeScript project references pass.

- [ ] **Step 3: Run validator**

Run:

```bash
pnpm run validate:all-experts
```

Expected: every available expert package validates.

- [ ] **Step 4: Run non-TTY workbench smoke**

Run:

```bash
pnpm --silent run crewclaw workbench --demo > log.txt
```

Expected: `log.txt` contains JSONL transcript lines and no ANSI escape sequence.

- [ ] **Step 5: Run interactive smoke where available**

Run in a real terminal:

```bash
pnpm --silent run crewclaw workbench --demo
```

Expected: enters alternate-screen Workbench, resizes without duplicated bars, and exits cleanly with `q` or `Ctrl+C`.

## Completion Criteria

- The spec document exists and contains TUI-001 through TUI-013.
- The plan document exists and references exact files and verification commands.
- Current code is audited against every TUI requirement.
- Any missing behavior has a failing test before implementation.
- `task.completed` without an artifact is blocked as `needs_artifact`.
- Ctrl+G cancels local input without quitting.
- Paste appends only while input is focused, with bracketed paste restored on exit.
- Focused input supports multiline entry, cursor movement, Delete/Backspace, ordinary text keys, command history, draft restoration, and a CJK-aware visible terminal cursor.
- `crew chat <employee>` routes to Workbench by default on TTY and `--plain` opts out.
- Targeted Rust workbench tests pass.
- Full Rust CLI tests pass.
- Non-TTY workbench output is clean and machine-readable.
- Manual TTY smoke is either completed or explicitly reported as not run.
