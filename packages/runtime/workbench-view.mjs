const newline = String.fromCharCode(10);

function isPresent(value) {
  return value !== undefined && value !== "";
}

function tick(pass, color) {
  const char = String.fromCharCode(pass ? 0x2713 : 0x2717);
  if (!color) return char;
  return `${pass ? "\x1b[32m" : "\x1b[31m"}${char}\x1b[0m`;
}

export function statusHeader({ name, role, model, status, cost }, opts = {}) {
  const fields = [
    ["Employee", name],
    ["Role", role],
    ["Status", status],
    ["Model", model],
    ["Cost", cost],
  ];

  return fields
    .filter(([, value]) => isPresent(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join(" | ");
}

export function timelinePanel(events = [], opts = {}) {
  return events
    .map((event, index) => `${index + 1}. ${event.summary}`)
    .join(newline);
}

export function acceptancePanel(
  {
    artifactId,
    toolCount,
    status,
    outputValid,
    gradePassed,
    missing = [],
    effective,
    feedback,
  },
  opts = {}
) {
  const color = opts.color === true;
  const lines = [
    "任务验收",
    `Artifact: ${artifactId} | Tools: ${toolCount} | Status: ${status}`,
    `${tick(outputValid === true, color)} 结构达标 | ${tick(gradePassed === true, color)} 验收规则`,
    `${tick(effective === true, color)} 有效任务 ${feedback ?? ""}`,
  ];

  if (missing.length > 0) {
    lines.push(`Missing: ${missing.join(", ")}`);
  }

  return lines.join(newline);
}

export function actionBar(
  commands = ["approve", "deny", "accept", "reject", "dream"],
  opts = {}
) {
  return `Command: ${commands.join(" / ")}`;
}
