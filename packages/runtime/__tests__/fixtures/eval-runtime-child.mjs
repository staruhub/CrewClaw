import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";

const scenario = process.argv[2] || "success";
const root = process.env.CREWCLAW_ROOT;
const taskRunId = "task-eval-fixture";
let phase = "task";

function emit(type, data) {
  process.stdout.write(
    `${JSON.stringify({ protocol_version: 1, type, ts: Date.now(), data })}\n`
  );
}

function exitSoon(code) {
  setTimeout(() => {
    process.exitCode = code;
    process.stdin.destroy();
  }, 10);
}

const input = readline.createInterface({ input: process.stdin });
input.on("line", line => {
  if (scenario === "timeout") return;
  if (scenario === "malformed") {
    process.stdout.write("not-json\n");
    exitSoon(0);
    return;
  }
  if (scenario === "no-terminal") {
    emit("task.started", { id: taskRunId });
    exitSoon(0);
    return;
  }
  if (scenario === "nonzero") {
    emit("task.started", { id: taskRunId });
    emit("task.failed", {
      id: taskRunId,
      taskRunId,
      reason: "fixture failure",
    });
    exitSoon(7);
    return;
  }

  let action;
  try {
    action = JSON.parse(line);
  } catch {
    process.stderr.write("fixture expected structured JSON input\n");
    exitSoon(8);
    return;
  }

  if (phase === "task") {
    if (action?.type !== "user.message") {
      process.stderr.write("fixture expected user.message\n");
      exitSoon(9);
      return;
    }
    phase = "tool";
    emit("task.started", { id: taskRunId });
    emit("approval.required", {
      id: "tool-eval-fixture",
      taskRunId,
      kind: "tool_authorization",
      tool: "browser_render",
      scope: "browser",
    });
    return;
  }

  if (phase === "tool") {
    if (
      action?.type !== "approval.resolve" ||
      action?.data?.id !== "tool-eval-fixture" ||
      action?.data?.decision !== "allow"
    ) {
      process.stderr.write("fixture expected correlated tool allow\n");
      exitSoon(10);
      return;
    }
    phase = "delivery";
    emit("approval.resolved", {
      id: "tool-eval-fixture",
      taskRunId,
      kind: "tool_authorization",
      decision: "allow",
    });
    const artifactPath = join(root, ".crewclaw", "artifacts", "fixture.md");
    mkdirSync(join(root, ".crewclaw", "artifacts"), { recursive: true });
    writeFileSync(
      artifactPath,
      "# Eval fixture\n\nThis artifact proves the event-driven evaluator completed its correlated approval lifecycle.\n"
    );
    emit("artifact.created", {
      id: "artifact-eval-fixture",
      taskRunId,
      path: artifactPath,
    });
    emit("approval.requested", {
      id: "delivery-eval-fixture",
      taskRunId,
      kind: "deliverable_acceptance",
    });
    return;
  }

  if (phase === "delivery") {
    if (
      action?.type !== "approval.resolve" ||
      action?.data?.id !== "delivery-eval-fixture" ||
      action?.data?.decision !== "accept"
    ) {
      process.stderr.write("fixture expected correlated delivery accept\n");
      exitSoon(11);
      return;
    }
    phase = "terminal";
    emit("approval.accepted", {
      id: "delivery-eval-fixture",
      taskRunId,
      kind: "deliverable_acceptance",
    });
    emit("task.completed", { id: taskRunId, taskRunId });
  }
});
