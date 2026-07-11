import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCommand, runCommand } from "../commands.mjs";

const root = mkdtempSync(join(tmpdir(), "crewclaw-commands-"));
mkdirSync(join(root, "registry"), { recursive: true });
writeFileSync(
  join(root, "registry", "experts.json"),
  JSON.stringify({
    experts: [
      {
        name: "code-review-shrimp",
        display_name: "Code Review Shrimp",
        status: "available",
        description: "Reviews pull requests.",
      },
      {
        name: "docs-octopus",
        display_name: "Docs Octopus",
        status: "coming-soon",
        description: "Writes docs.",
      },
    ],
  }),
  "utf8"
);

const ctx = {
  agentId: "code-review-shrimp",
  name: "Code Review Shrimp",
  model: "anthropic/claude-opus-4.8",
  tools: ["bash", "search", "read_file", "edit_file", "write_file"],
  root,
  color: false,
};

assert.equal(isCommand("/help"), true);
assert.equal(isCommand(" /help"), false);
assert.equal(isCommand("hello"), false);

const help = runCommand("/help", ctx);
assert.equal(help.handled, true);
assert.match(help.text, /\/help/);
assert.match(help.text, /\/agent <id>/);

const tools = runCommand("/tools", ctx);
assert.equal(tools.handled, true);
assert.match(tools.text, /bash/);
assert.match(tools.text, /write_file/);
assert.doesNotMatch(tools.text, /\x1b\[/);

const model = runCommand("/model", ctx);
assert.equal(model.handled, true);
assert.match(model.text, /anthropic\/claude-opus-4\.8/);

assert.deepEqual(runCommand("/clear", ctx), {
  handled: true,
  action: { type: "clear" },
});
assert.deepEqual(runCommand("/reset", ctx), {
  handled: true,
  action: { type: "clear" },
});

const crew = runCommand("/crew", ctx);
assert.equal(crew.handled, true);
assert.match(
  crew.text,
  /code-review-shrimp · Code Review Shrimp · Reviews pull requests\./
);
assert.doesNotMatch(crew.text, /docs-octopus/);

assert.deepEqual(runCommand("/agent code-review-shrimp", ctx), {
  handled: true,
  action: { type: "switch", agent: "code-review-shrimp" },
});
assert.deepEqual(runCommand("/switch code-review-shrimp", ctx), {
  handled: true,
  action: { type: "switch", agent: "code-review-shrimp" },
});

const invalid = runCommand("/agent docs-octopus", ctx);
assert.equal(invalid.handled, true);
assert.match(invalid.text, /Unknown or unavailable agent/);
assert.match(invalid.text, /code-review-shrimp/);

const missing = runCommand("/agent", ctx);
assert.equal(missing.handled, true);
assert.match(missing.text, /Usage: \/agent <id>/);

assert.deepEqual(runCommand("/exit", ctx), {
  handled: true,
  action: { type: "exit" },
});
assert.deepEqual(runCommand("/quit", ctx), {
  handled: true,
  action: { type: "exit" },
});

const unknown = runCommand("/wat", ctx);
assert.equal(unknown.handled, true);
assert.match(unknown.text, /Unknown command/);
assert.match(unknown.text, /\/help/);
