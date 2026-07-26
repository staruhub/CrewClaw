import assert from "node:assert/strict";
import {
  EVAL_PROVIDER_STATES,
  buildGrowthCard,
  classifyEvalProviderFailure,
  classifyEvalProviderStatus,
} from "../eval-provider.mjs";

assert.deepEqual(EVAL_PROVIDER_STATES, [
  "available",
  "missing_credentials",
  "authentication_failed",
  "rate_limited",
  "unavailable",
]);

assert.equal(classifyEvalProviderStatus({ ok: true }).status, "available");
assert.equal(
  classifyEvalProviderStatus({ code: "missing_key" }).status,
  "missing_credentials"
);
assert.equal(
  classifyEvalProviderStatus({ code: "forbidden_key_valid" }).status,
  "authentication_failed"
);
assert.equal(classifyEvalProviderStatus(429).status, "rate_limited");
assert.equal(classifyEvalProviderStatus(503).status, "unavailable");
assert.equal(
  classifyEvalProviderFailure({
    reason_code: "network_error",
    reason: "model provider network request failed",
  })?.status,
  "unavailable"
);
assert.equal(
  classifyEvalProviderFailure({ reason: "fetch failed" })?.status,
  "unavailable"
);
assert.equal(
  classifyEvalProviderFailure({ reason_code: "forbidden", http_status: 403 })
    ?.status,
  "authentication_failed"
);
assert.equal(
  classifyEvalProviderFailure({
    reason_code: "artifact_invalid",
    reason: "deliverable is too small",
  }),
  null,
  "unknown task/output failures are not mislabeled as provider outages"
);

const card = buildGrowthCard({
  employeeId: "product-prd-crab",
  evalResult: null,
  provider: { code: "missing_credentials" },
  kpi: { accepted: 2, tasks: 5, cost_usd: 1.2 },
});
assert.equal(card.contract, "crewclaw.growth-card/v1");
assert.equal(card.employee_id, "product-prd-crab");
assert.equal(card.provider.status, "missing_credentials");
assert.equal(card.eval, null);
assert.equal(card.kpi.accepted, 2);
assert.match(card.next_step, /ZENMUX_API_KEY|crew eval/i);

const certified = buildGrowthCard({
  employeeId: "whale",
  evalResult: {
    score: 88,
    verdict: "PASS",
    mock: false,
    provider_status: "verified",
    model: "judge",
  },
  provider: { ok: true, code: "verified" },
});
assert.equal(certified.eval.certified, true);
assert.equal(certified.eval.score, 88);
assert.match(certified.next_step, /Certified baseline/i);

console.log("eval-provider.test.mjs passed");
