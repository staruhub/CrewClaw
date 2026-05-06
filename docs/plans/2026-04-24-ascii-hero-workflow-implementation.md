# ASCII Hero Workflow Implementation Plan

Date: 2026-04-24
Mode: executing-plans

## Goal

Upgrade the homepage hero from a generic ASCII background into a Midjourney-like atmospheric ASCII flow field that subtly communicates an agent workflow:

`task -> planner -> parallel agents -> verifier -> result`

## Constraints

- Reuse the existing `Hero`, `AsciiCanvas`, and `Terminal` patterns.
- Keep the animation full-screen in the hero background.
- Favor atmosphere over explicit UI diagrams.
- Use only faint ghost labels for semantic hints.
- Avoid introducing a new rendering stack or a video asset for the first pass.
- Preserve readability of hero copy and CTA content.
- Keep mobile behavior and runtime performance in mind.
- Start a fresh dev server after implementation and verification.

## Files In Scope

- `src/components/AsciiCanvas.tsx`
- `src/sections/Hero.tsx`
- `src/components/Terminal.tsx`

## Execution Tasks

### Task 1: Replace static agent regions with a staged ASCII flow field

- Rework `AsciiCanvas.tsx` to use a timed phase loop instead of fixed labeled regions.
- Add phases that imply:
  - idle drift
  - task gather
  - parallel split
  - verification pull
  - dissolve back
- Keep the motion continuous and slow, with no hard cuts.
- Reduce visual noise in the center so the hero copy remains legible.
- Replace constant agent labels with faint ghost labels such as `PLANNER`, `AGENTS`, and `VERIFY`.

Verification:

- TypeScript compiles cleanly.
- The animation remains responsive on resize.
- The hero center stays visually calmer than the corners and side regions.

### Task 2: Tune hero foreground composition to fit the new background

- Adjust `Hero.tsx` only as needed to preserve clean text readability over the new animated background.
- Keep the current layout pattern.
- Add only light supporting overlays or glow treatments if needed.

Verification:

- Heading, paragraph, and buttons stay readable over the animated background.
- The hero still matches the rest of the page visual language.

### Task 3: Align terminal preview with the workflow narrative

- Update `Terminal.tsx` and/or the hero command string if a better command improves the story.
- Keep the component pattern intact.
- Avoid turning the terminal into a full UI panel.

Verification:

- Terminal typing effect still works.
- Command text better matches the planner/agent/verify story.

### Task 4: Run project verification

- Run `npm run check`
- Run `npm run build`

If either fails, fix only issues introduced by this change set.

### Task 5: Restart local dev server

- Kill any existing related dev server processes for this project.
- Start a fresh server for manual testing.
- Report the local URL and the commands used.

## Acceptance Criteria

- The hero background feels more like a living generative system than a static ASCII wallpaper.
- The motion reads closer to a Midjourney-like ambient generation field.
- Users can subtly sense planner/agents/verify flow without explicit boxed UI.
- Existing hero structure is preserved.
- Typecheck/build pass.
- A fresh dev server is running for testing.
