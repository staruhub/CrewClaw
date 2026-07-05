# Workbench v1.1 Web Design

## Product Boundary

CrewClaw Web is the hiring and trial surface: employees, employee detail, hire flow, Doctor checks, and trial TaskRun review.

OpenWork Workbench is the long-running work surface: workspace tasks, artifacts, previews, checks, approvals, tools, and Inspect.

## Shared Object Model

The Web workbench follows the same language as the Ratatui TUI:

- `TaskRun`: formal unit of work, not a chat transcript.
- `Timeline`: compact action/event history.
- `Artifact`: first-class deliverable with status, summary, checks, preview, and path.
- `PendingAction`: explicit user actions instead of ambiguous free-form digits.
- `Inspect`: debug lines, raw events, tool truth, and cost context.

## Current Implementation

`/task-run/:id` is now a CrewClaw trial workbench backed by fixture data in `src/data/task-runs.ts`.

Component split:

- `WorkbenchShell`: page composition, header, pending actions, selected artifact state.
- `TimelinePanel`: compact event stream.
- `ArtifactPanel`: artifact list and selection.
- `ArtifactPreview`: lightweight preview for markdown/json/code-style artifacts.
- `OutcomeChecks`: artifact and task acceptance checks.
- `ToolAudit`: tool and permission table.
- `InspectPanel`: debug and raw JSONL event names.

This is intentionally not an Office editor. Word, PPT, Excel, and CSV remain lightweight previews until OpenWork owns editing.
