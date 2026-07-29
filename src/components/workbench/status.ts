export function statusSymbol(status: string) {
  if (["accepted", "delivered", "ready", "passed", "success"].includes(status))
    return "✓";
  if (["rejected", "failed", "deleted", "blocked", "error"].includes(status))
    return "✗";
  if (["running", "running_tool", "streaming", "tool_called"].includes(status))
    return "→";
  if (
    [
      "idle",
      "created",
      "planned",
      "draft",
      "waiting",
      "awaiting_approval",
    ].includes(status)
  )
    return "?";
  return "!";
}

export function statusClass(status: string) {
  if (
    ["accepted", "delivered", "ready", "passed", "success"].includes(status)
  ) {
    return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
  }
  if (["rejected", "failed", "deleted", "blocked", "error"].includes(status)) {
    return "border-red-300/35 bg-red-400/10 text-red-100";
  }
  if (
    [
      "needs_review",
      "warning",
      "draft",
      "waiting",
      "awaiting_approval",
    ].includes(status)
  ) {
    return "border-amber-300/35 bg-amber-400/10 text-amber-100";
  }
  if (
    ["running", "running_tool", "streaming", "tool_called"].includes(status)
  ) {
    return "border-sky-300/35 bg-sky-400/10 text-sky-100";
  }
  return "border-white/10 bg-white/[0.03] text-crew-body";
}

export function honestRunState(status: string) {
  if (["accepted", "delivered"].includes(status)) return "delivered";
  if (["failed", "rejected"].includes(status)) return "failed";
  if (["awaiting_approval", "needs_review"].includes(status)) return "waiting";
  if (["running", "running_tool", "streaming"].includes(status))
    return "streaming";
  return "idle";
}
