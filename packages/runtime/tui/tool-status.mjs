// One projection of the canonical ToolCatalog + employee resolver result for onboarding/status.
// A frozen resolver snapshot is the availability truth; ambient provider health cannot mutate it
// after session creation, and can never make an undeclared tool appear available.
import { getToolTruth, STATUS } from "../tool-truth.mjs";

const CODE = Object.freeze({
  [STATUS.missing_key]: "missing_key",
  [STATUS.unavailable]: "tool_unavailable",
  [STATUS.degraded]: "provider_degraded",
  [STATUS.rate_limited]: "rate_limited",
  [STATUS.permission_required]: "permission_required",
  [STATUS.configured_unverified]: "unverified",
  [STATUS.disabled]: "disabled",
});

export function getToolStatus(env = process.env, opts = {}) {
  return getToolTruth(env, opts).map(state => ({
    tool: state.capability,
    runtime_tool: state.runtime_tool,
    ok: state.status === STATUS.available,
    label: state.provider || state.status,
    reason:
      state.status === STATUS.available
        ? ""
        : state.detail || `capability status=${state.status}`,
    code:
      state.status === STATUS.available
        ? ""
        : CODE[state.status] || "tool_unavailable",
    status: state.status,
  }));
}

const SHORT = Object.freeze({
  "web.search": "search",
  "web.fetch": "fetch",
  "web.fetch_extract": "fetch+extract",
  "browser.render": "render",
  "source.verify": "verify",
  "evidence.create": "evidence",
  "artifact.report": "artifact",
});

export function toolStatusLine(status = getToolStatus()) {
  return status
    .map(item => `${SHORT[item.tool] || item.tool} ${item.ok ? "✓" : "✗"}`)
    .join(" · ");
}
