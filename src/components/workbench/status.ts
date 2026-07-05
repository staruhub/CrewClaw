export function statusSymbol(status: string) {
  if (["accepted", "delivered", "ready", "passed", "success"].includes(status)) return "✓";
  if (["rejected", "failed", "deleted", "blocked"].includes(status)) return "✗";
  if (["running"].includes(status)) return "→";
  return "!";
}

export function statusClass(status: string) {
  if (["accepted", "delivered", "ready", "passed", "success"].includes(status)) {
    return "border-emerald-400/35 bg-emerald-400/10 text-emerald-200";
  }
  if (["rejected", "failed", "deleted", "blocked"].includes(status)) {
    return "border-red-300/35 bg-red-400/10 text-red-100";
  }
  if (["needs_review", "warning", "draft"].includes(status)) {
    return "border-amber-300/35 bg-amber-400/10 text-amber-100";
  }
  return "border-white/10 bg-white/[0.03] text-crew-body";
}
