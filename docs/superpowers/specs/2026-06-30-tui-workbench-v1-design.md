# TUI Workbench Spec v1

Status: Draft for implementation
Date: 2026-06-30
Product area: CrewClaw CLI / Ratatui Workbench

## Goal

CrewClaw must move from chat-style terminal output to a full-screen terminal application: an AI employee workbench that renders structured agent activity, artifacts, tools, approvals, and user actions from an event stream.

The default user experience for interactive employee work should feel like entering an app, not watching stdout scroll. `crew chat <employee>`, `crew run <employee> --task <id>`, and `crew workbench --demo` should prefer the workbench when stdout is a TTY. Non-interactive use must degrade to clean plain or JSONL output. The current prototype routes `crew chat <employee>` and manifest task mode `crew run <employee> --task <id>` into the Rust Workbench on TTY; one-shot free-form `crew run <employee> "<task>"` remains legacy plain output until it has a structured TaskEvent bridge.

## Product Principles

1. Agent first, not render first. The primary interface is agent activity, not raw assistant text.
2. Event to state to frame. Runtime output becomes structured events, reducers update `AppState`, and Ratatui renders a fresh frame.
3. No artifact, no done. Formal task runs cannot be treated as complete without a managed artifact or an explicit rejected/no-deliverable state.
4. Keyboard is the primary path. Mouse support can improve the experience but must not be required.
5. Logs are not UI. Debug output belongs in Inspect or log files, never in the main timeline.

## Architecture

The workbench is split into four concerns:

- Runtime: model, tools, permissions, task state, artifact creation, and outcome checks.
- Event stream: JSONL over stdio for the first implementation, with room for future SSE/WebSocket transport.
- Protocol: `TaskEvent` wire format for task, plan, skill, tool, approval, artifact, memory, evidence, and outcome events.
- Ratatui client: terminal ownership, event loop, `AppState`, responsive layout, input, shortcuts, and rendering.

The Ratatui client must not parse raw model text as the primary source of truth. It consumes `TaskEvent` values and folds them into `AppState`.

```text
Crew Runtime
  -> TaskEvent JSONL
  -> Ratatui Workbench Client
  -> AppState reducer
  -> full frame render
  -> UserAction lines back to runtime
```

## Required Behavior

### TUI-001: Full-screen App Mode

When stdout is a TTY and workbench mode is requested, CrewClaw must enter raw mode and alternate screen before rendering. On normal exit, Ctrl+C, or panic, it must restore raw mode, cursor visibility, and the previous terminal screen.

When stdout is not a TTY, CrewClaw must not emit ANSI control sequences. It must output clean JSONL/plain transcript data.

### TUI-002: Resize Stability

Resize must trigger a full redraw from `AppState`. It must not append duplicate status bars, duplicate panels, or leave stale content. Layout is recomputed every frame from the current terminal area.

Responsive breakpoints:

- Wide, width >= 100: tasks/employee left, timeline center, artifacts/tools/inspect right.
- Mid, width >= 70 and < 100: tasks/artifacts side column plus timeline/tools/inspect main column.
- Narrow, width < 70: single content panel with tabs for Timeline, Artifacts, Tools, Inspect.

### TUI-003: Keyboard Complete

Core operations must be reachable by keyboard:

- `Tab` / `Shift+Tab`: cycle focus, or cycle tabs in narrow mode.
- `1` to `4`: select narrow tabs.
- `Up` / `Down`: scroll focused panel.
- `Enter`: activate selected item or submit focused input.
- `Alt+Enter`: insert a newline in focused input.
- `Esc`: close overlay/input or move focus back.
- `Ctrl+G`: cancel current input, overlay, or local action without quitting.
- `Ctrl+P`: command palette.
- `/`: slash-command input.
- `?`: help overlay.
- `q` / `Ctrl+C`: quit.
- Focused input must support visible cursor movement with `Left`, `Right`, `Home`, `End`, `Backspace`, and `Delete`.
- Focused input must use `Up` / `Down` for submitted input history navigation and draft restoration; panel scrolling remains the `Up` / `Down` behavior only when input is not focused.
- Focused input must support multiline input without changing the plain `Enter` submit behavior.
- Plain text command keys such as `q`, `/`, and `?` must insert text when input is focused rather than hijacking the input buffer.
- Pending action digits must route to the pending action system when input is not focused.

### TUI-004: Mouse Optional

Mouse support may be added in a future pass for clicking panels, scrolling, and selecting actions. It must remain optional.

### TUI-005: Color Is Not Meaning

Every status must include text or a symbol in addition to color:

- `✓`: ready/done/accepted/ok
- `✗`: failed/rejected/unavailable
- `!`: warning/blocked
- `→`: running
- `?`: waiting/draft/idle

### TUI-006: CJK, Emoji, ANSI, Markdown

The renderer must measure display width, not byte length or character count, when truncating or fitting visible content. CJK text, emoji, mixed Chinese/English text, and ANSI-styled content must not corrupt panel layout.

Markdown is not a layout format. Runtime markdown should become events, artifacts, or compact previews. Long reports and wide tables should appear as artifacts or summaries, not raw timeline text.

### TUI-007: Plain/JSON Degrade Mode

Non-TTY execution must degrade automatically. Supported modes:

- Plain transcript for `crew workbench` with piped event input.
- JSON-compatible lines without ANSI escape codes.
- Runtime errors on stderr where applicable.
- `crew chat <employee> --plain` forces the legacy plain terminal stream.
- `crew chat <employee> --tui` and `--ratatui` explicitly request the Ratatui workbench; on non-TTY stdout they still degrade to plain runtime output.

### TUI-008: Agent Events Become Timeline

The timeline renders structured events such as:

- `task.started`
- `plan.created`
- `skill.launched`
- `tool.requested`
- `tool.succeeded`
- `tool.failed`
- `artifact.created`
- `approval.requested`
- `memory.saved`
- `outcome.checked`
- `task.completed`

Raw `token.delta` can be shown only as a compact answer preview, not as the main information architecture.

### TUI-009: Artifacts Are First-class

Artifacts must have identity, name, kind/type, path, status, and checks when available. The workbench must keep an Artifacts panel visible in wide/mid layouts and available as a tab in narrow layouts.

Artifact statuses include:

- `draft`
- `ready`
- `needs_review`
- `accepted`
- `rejected`
- `exported`

### TUI-010: Debug Lives in Inspect

Debug events, raw JSON, tool details, latency, provider data, and error messages are available through Inspect. They must not pollute the main timeline.

In live Workbench mode, runtime stderr must be captured by the Rust client and surfaced as Inspect debug lines. It must not inherit the terminal stderr handle while the alternate screen is active, because that would corrupt the full-screen UI.

### TUI-011: Pending Actions Are System-owned

When the runtime emits `pending.actions`, the client displays the action list and routes matching digit keys back to the runtime. The model must not guess what a bare `1` means.

### TUI-012: Tool Truth and Doctor

Tools must show true availability and status. Missing keys, blocked tools, confirmation requirements, and failures must render with symbols and text. Doctor should be able to explain why an employee or tool cannot proceed.

### TUI-013: Paste Is Focused Input

TTY workbench mode must enable bracketed paste so terminal paste arrives as structured paste input instead of simulated keystrokes. Pasted content appends only when the input box is focused. Pasting while browsing panels must not mutate pending input. On normal exit or panic restoration, bracketed paste must be disabled with the rest of terminal state.

## Current Implementation Map

The MVP implementation lives in:

- `crates/crewclaw-cli/src/workbench/mod.rs`: terminal ownership, TTY degrade, event loop, runtime process bridge, input handling.
- `crates/crewclaw-cli/src/workbench/state.rs`: `AppState`, reducers, symbols, focus state, pending actions.
- `crates/crewclaw-cli/src/workbench/ui.rs`: responsive Ratatui layout and panels.
- `crates/crewclaw-cli/src/workbench/protocol.rs`: `TaskEvent` wire protocol.
- `packages/runtime/run.mjs`: Node runtime JSONL mode via `CREW_TUI=ratatui` for chat and manifest task runs.
- `packages/runtime/tui/*.mjs`: renderer-agnostic event and app-state helpers for the Node side.

## Testing Requirements

Required automated coverage:

- JSONL transcript contains no ANSI sequences in non-TTY mode.
- Resize path clears/redraws from state.
- Responsive layout breakpoints match the spec.
- CJK truncation uses display width.
- Status symbols carry meaning independent of color.
- Approval modal is keyboard-operable.
- Pending action digits route only when input is not focused and approval is not active.
- Ctrl+G cancels focused input and clears the buffer.
- Paste appends text only when input is focused.
- Focused input exposes a real terminal cursor positioned by display width, including CJK text.
- Focused input records submitted command history and restores the current draft after navigating back down through history.
- Multiline input uses `Alt+Enter` for newline insertion, renders each line in the input area, and positions the cursor on the active row.
- Unknown events do not crash the reducer.
- Artifacts, tools, evidence, memory, and outcome events reduce into visible state.
- Live runtime stderr is captured into Inspect/debug instead of being inherited into the alternate-screen terminal.

Required manual smoke:

```bash
pnpm --silent run crewclaw workbench --demo
pnpm --silent run crewclaw workbench --demo > log.txt
pnpm --silent run crewclaw chat ai-adoption-whale
```

The first command should enter full-screen Workbench on a TTY. The second command should produce clean transcript output with no terminal control codes. The third command should spawn the Node runtime in JSONL mode and render live events when credentials are configured.

## References

- Ratatui FAQ: Ratatui provides terminal UI primitives; the application owns event loops, state, and rendering policy.
- Ratatui alternate screen documentation: alternate screen is a separate terminal buffer that should be entered for full-screen apps and restored on exit.
- Unicode East Asian Width: CJK and full-width characters need display-width-aware truncation.
