import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// Guard: generation must not emit mid-stream assistant.rendering_preview.
// The 200ms typeset overlay used to swallow the 30ms reveal-pacer cadence.
const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = resolve(here, "../tui/jsonl-bridge.mjs");
const source = readFileSync(bridgePath, "utf8");

assert.equal(
  /maybeEmitMarkdownPreview/.test(source),
  false,
  "mid-stream markdown preview helper must stay removed"
);
assert.equal(
  /MARKDOWN_PREVIEW_INTERVAL_MS/.test(source),
  false,
  "200ms markdown preview throttle must stay removed"
);
assert.match(
  source,
  /ASSISTANT_RENDERED/,
  "final typeset still lands on assistant.rendered"
);
assert.match(
  source,
  /createRevealPacer/,
  "reveal-pacer remains the live stream cadence"
);

// Keep the event name for protocol compatibility (front-ends may still ignore it),
// but generation must not call it from emitRevealedDelta.
assert.match(source, /ASSISTANT_RENDERING_PREVIEW/);
assert.doesNotMatch(source, /emitTurn\(EVENTS\.ASSISTANT_RENDERING_PREVIEW/);

// Silence unused import lint in environments that typecheck this as TS-ish.
void createRequire;

console.log("markdown-preview-stream.test.mjs passed");
