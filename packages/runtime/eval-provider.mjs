// EvalProvider — five-state abstraction for judge / certification provider health.
// Dream activation and formal certification both refuse silent mock downgrades;
// UI surfaces (Growth Card / doctor / DREAM blockers) read these states instead
// of free-form strings.

export const EVAL_PROVIDER_STATES = Object.freeze([
  "available",
  "missing_credentials",
  "authentication_failed",
  "rate_limited",
  "unavailable",
]);

export const EVAL_PROVIDER_STATE_SET = new Set(EVAL_PROVIDER_STATES);

const PROVIDER_FAILURE_CODES = new Set([
  "missing_key",
  "missing_credentials",
  "unauthorized",
  "forbidden",
  "forbidden_key_valid",
  "authentication_failed",
  "rate_limited",
  "too_many_requests",
  "timeout",
  "network_error",
  "no_model",
  "model_not_found",
  "provider_error",
  "provider_response_invalid",
  "unavailable",
]);

/**
 * Map probe / HTTP outcomes onto the five EvalProvider states.
 * Accepts either a probeModelAccess-shaped object or a raw HTTP status.
 */
export function classifyEvalProviderStatus(input = {}) {
  if (input === null || input === undefined) {
    return {
      status: "unavailable",
      code: "empty",
      message: "Eval provider status is unknown.",
    };
  }

  if (typeof input === "number") {
    return classifyHttp(input);
  }

  if (typeof input === "string") {
    return classifyCode(input);
  }

  if (input.ok === true || input.status === "available") {
    return {
      status: "available",
      code: input.code || "ok",
      message: input.message || "Eval provider is ready.",
      model: input.model,
    };
  }

  if (input.code) {
    const fromCode = classifyCode(input.code, input);
    if (fromCode) return fromCode;
  }

  if (typeof input.status === "number") {
    return classifyHttp(input.status, input);
  }

  if (EVAL_PROVIDER_STATE_SET.has(input.status)) {
    return {
      status: input.status,
      code: input.code || input.status,
      message: input.message || defaultMessage(input.status),
      model: input.model,
      hint: input.hint,
    };
  }

  return {
    status: "unavailable",
    code: input.code || "unavailable",
    message: input.message || defaultMessage("unavailable"),
    model: input.model,
    hint: input.hint,
  };
}

/**
 * Recognize only failures that are clearly attributable to the eval/model provider.
 * Unknown task failures deliberately return null so a genuine employee rejection or
 * policy block can still be graded. This is narrower than classifyEvalProviderStatus,
 * whose unknown-input fallback is intentionally "unavailable" for UI health cards.
 */
export function classifyEvalProviderFailure(input = {}) {
  if (!input || typeof input !== "object") return null;

  const nested =
    input.provider && typeof input.provider === "object"
      ? input.provider
      : null;
  if (
    nested &&
    EVAL_PROVIDER_STATE_SET.has(nested.status) &&
    nested.status !== "available"
  ) {
    return classifyEvalProviderStatus(nested);
  }

  const rawCode = String(
    input.reason_code || input.error_code || input.code || ""
  )
    .trim()
    .toLowerCase();
  const httpFromCode = rawCode.match(/^http_(\d{3})$/);
  if (httpFromCode) {
    return classifyEvalProviderStatus({
      status: Number(httpFromCode[1]),
      message: input.reason || input.message,
      model: input.model,
    });
  }
  if (PROVIDER_FAILURE_CODES.has(rawCode)) {
    const normalizedCode = [
      "model_not_found",
      "provider_error",
      "provider_response_invalid",
    ].includes(rawCode)
      ? "unavailable"
      : rawCode;
    return classifyEvalProviderStatus({
      code: normalizedCode,
      message: input.reason || input.message,
      model: input.model,
    });
  }

  const numericStatus = Number(input.http_status);
  if (Number.isInteger(numericStatus) && numericStatus >= 100) {
    return classifyEvalProviderStatus({
      status: numericStatus,
      message: input.reason || input.message,
      model: input.model,
    });
  }

  const reason = String(input.reason || input.message || "").trim();
  const httpFromReason = reason.match(
    /\b(?:judge model|model provider|model)\s+HTTP\s+(\d{3})\b/i
  );
  if (httpFromReason) {
    return classifyEvalProviderStatus({
      status: Number(httpFromReason[1]),
      message: reason,
      model: input.model,
    });
  }
  if (
    /\bfetch failed\b/i.test(reason) ||
    /\b(?:network request failed|network error|ECONNREFUSED|ECONNRESET|ENETUNREACH|EAI_AGAIN)\b/i.test(
      reason
    )
  ) {
    return classifyEvalProviderStatus({
      code: "network_error",
      message: reason,
      model: input.model,
    });
  }
  if (
    /\bmodel stream was idle\b/i.test(reason) ||
    /\bmodel generation exceeded\b/i.test(reason) ||
    /\bprovider request timed out\b/i.test(reason)
  ) {
    return classifyEvalProviderStatus({
      code: "timeout",
      message: reason,
      model: input.model,
    });
  }

  return null;
}

function classifyHttp(status, extra = {}) {
  if (status === 401) {
    return {
      status: "authentication_failed",
      code: "http_401",
      message: extra.message || "Eval provider rejected the credentials.",
      model: extra.model,
      hint: extra.hint,
    };
  }
  if (status === 403) {
    return {
      status: "authentication_failed",
      code:
        extra.code === "forbidden_key_valid"
          ? "forbidden_key_valid"
          : "http_403",
      message:
        extra.message ||
        "Eval provider key is present but has no inference permission.",
      model: extra.model,
      hint:
        extra.hint ||
        "Open the provider console and enable inference / top up credits; local dev may use CREW_MOCK=1.",
    };
  }
  if (status === 429) {
    return {
      status: "rate_limited",
      code: "http_429",
      message: extra.message || "Eval provider rate limit hit.",
      model: extra.model,
      hint: extra.hint,
    };
  }
  if (status >= 200 && status < 300) {
    return {
      status: "available",
      code: "ok",
      message: extra.message || "Eval provider is ready.",
      model: extra.model,
    };
  }
  return {
    status: "unavailable",
    code: `http_${status}`,
    message: extra.message || `Eval provider HTTP ${status}.`,
    model: extra.model,
    hint: extra.hint,
  };
}

function classifyCode(code, extra = {}) {
  const normalized = String(code || "").trim();
  switch (normalized) {
    case "ok":
    case "mock":
    case "available":
      return {
        status: "available",
        code: normalized,
        message: extra.message || "Eval provider is ready.",
        model: extra.model,
      };
    case "missing_key":
    case "missing_credentials":
      return {
        status: "missing_credentials",
        code: normalized,
        message:
          extra.message ||
          "Eval provider credentials are missing (set ZENMUX_API_KEY).",
        model: extra.model,
        hint: extra.hint || "Set ZENMUX_API_KEY in crewhire/.env.local.",
      };
    case "unauthorized":
    case "forbidden":
    case "forbidden_key_valid":
    case "authentication_failed":
      return {
        status: "authentication_failed",
        code: normalized,
        message:
          extra.message ||
          "Eval provider credentials are invalid or lack inference permission.",
        model: extra.model,
        hint:
          extra.hint ||
          "Key may list models but cannot call the judge model — fix provider account permissions.",
      };
    case "rate_limited":
    case "too_many_requests":
      return {
        status: "rate_limited",
        code: normalized,
        message: extra.message || "Eval provider rate limit hit.",
        model: extra.model,
        hint: extra.hint,
      };
    case "timeout":
    case "network_error":
    case "no_model":
    case "unavailable":
      return {
        status: "unavailable",
        code: normalized,
        message: extra.message || defaultMessage("unavailable"),
        model: extra.model,
        hint: extra.hint,
      };
    default:
      return null;
  }
}

function defaultMessage(status) {
  switch (status) {
    case "available":
      return "Eval provider is ready.";
    case "missing_credentials":
      return "Eval provider credentials are missing.";
    case "authentication_failed":
      return "Eval provider authentication failed.";
    case "rate_limited":
      return "Eval provider is rate limited.";
    default:
      return "Eval provider is unavailable.";
  }
}

/**
 * Growth Card projection — honest, never fabricates a certified score.
 * Used by EVAL/DREAM surfaces and any future Growth Card UI.
 */
export function buildGrowthCard({
  employeeId,
  evalResult = null,
  provider = null,
  kpi = null,
} = {}) {
  const providerStatus = classifyEvalProviderStatus(
    provider ||
      (evalResult?.provider_status
        ? {
            status: evalResult.provider_status,
            code: evalResult.provider_status,
          }
        : evalResult
          ? evalResult.mock === false
            ? { status: "available", code: "verified" }
            : { status: "unavailable", code: "unverified" }
          : { status: "missing_credentials", code: "no_eval" })
  );

  const hasResult = !!evalResult && typeof evalResult === "object";
  const mock = hasResult ? evalResult.mock !== false : true;
  const certified = hasResult && evalResult.mock === false;
  const score =
    hasResult && Number.isFinite(Number(evalResult.score))
      ? Number(evalResult.score)
      : null;

  return {
    contract: "crewclaw.growth-card/v1",
    employee_id: employeeId || null,
    provider: providerStatus,
    eval: hasResult
      ? {
          score,
          verdict: String(evalResult.verdict || ""),
          mock,
          certified,
          provider_status: String(evalResult.provider_status || ""),
          evaluated_at: evalResult.evaluated_at ?? null,
          model: evalResult.model ?? evalResult.judge_model ?? null,
        }
      : null,
    kpi: kpi
      ? {
          accepted: Number(kpi.accepted) || 0,
          tasks: Number(kpi.tasks) || 0,
          cost_usd: Number(kpi.cost_usd) || 0,
        }
      : null,
    next_step: growthNextStep({ providerStatus, certified, hasResult }),
  };
}

function growthNextStep({ providerStatus, certified, hasResult }) {
  if (providerStatus.status === "missing_credentials") {
    return "Set ZENMUX_API_KEY (or another OpenAI-compatible judge key) and run crew eval <slug>.";
  }
  if (providerStatus.status === "authentication_failed") {
    return "Provider key is present but cannot call the judge model — fix account inference permission, then re-run crew eval.";
  }
  if (providerStatus.status === "rate_limited") {
    return "Wait for the rate limit window, then re-run crew eval.";
  }
  if (providerStatus.status === "unavailable") {
    return "Restore network / provider availability, then re-run crew eval.";
  }
  if (!hasResult) {
    return "Run crew eval <slug> to produce the first certified baseline.";
  }
  if (!certified) {
    return "Current score is mock-only. Re-run crew eval without --mock once the provider is verified.";
  }
  return "Certified baseline is live. Dream activation may proceed when other gates pass.";
}
