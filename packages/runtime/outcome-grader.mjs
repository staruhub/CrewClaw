export const RESEARCH_RUBRIC = [
  { key: "object_confirmed", label: "目标对象已确认", kind: "model" },
  { key: "source_quality", label: "来源质量", kind: "rule" },
  { key: "cross_verified", label: "交叉核实", kind: "model" },
  { key: "field_completeness", label: "字段完整性", kind: "rule" },
  { key: "confidence_labeled", label: "置信度标注", kind: "rule" },
  { key: "scenario_advice", label: "场景建议", kind: "model" },
  { key: "risk_stated", label: "风险说明", kind: "model" },
  { key: "no_fabrication", label: "无捏造", kind: "rule" },
  { key: "readable", label: "可读性", kind: "model" },
];

const FIELD_TOKENS = [
  "名称",
  "价格",
  "上下文",
  "能力",
  "来源",
  "置信度",
  "name",
  "price",
  "context",
  "capability",
  "source",
  "confidence",
];

const URL_RE = /https?:\/\/\S+/i;
const NUMERIC_CLAIM_RE = new RegExp("\\d+\\s*(元|\\$|\\u00a5|token)", "i");

function textValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function checkRule(key, text) {
  if (key === "source_quality") {
    const passed = URL_RE.test(text);
    return {
      key,
      passed,
      reason: passed ? "包含 URL 来源" : "缺少 URL 来源",
    };
  }

  if (key === "field_completeness") {
    const lower = text.toLowerCase();
    const tokenCount = FIELD_TOKENS.filter(token =>
      lower.includes(token.toLowerCase())
    ).length;
    const passed = text.length >= 120 && tokenCount >= 3;
    return {
      key,
      passed,
      reason: passed ? "长度和字段覆盖达标" : "长度不足或字段覆盖不足",
    };
  }

  if (key === "confidence_labeled") {
    const passed = /置信度|高|中|低|high|medium|low/i.test(text);
    return {
      key,
      passed,
      reason: passed ? "包含置信度标注" : "缺少置信度标注",
    };
  }

  if (key === "no_fabrication") {
    const failed = NUMERIC_CLAIM_RE.test(text) && !URL_RE.test(text);
    return {
      key,
      passed: !failed,
      reason: failed ? "数值声明缺少 URL 来源支撑" : "未发现无来源数值声明",
    };
  }

  return {
    key,
    passed: true,
    reason: "no rule",
  };
}

export function ruleCheck(artifactText, rubric = RESEARCH_RUBRIC) {
  const text = textValue(artifactText);
  const checks = [];

  for (const dimension of rubric || []) {
    if (dimension?.kind === "rule") {
      checks.push(checkRule(dimension.key, text));
    }
  }

  const hardFails = checks.filter(check => !check.passed).length;
  return { checks, hardFails };
}

async function runModelCheck(task, text, dimension, modelFn) {
  if (typeof modelFn !== "function") {
    return {
      key: dimension.key,
      passed: true,
      reason: "skipped (no grader model)",
    };
  }

  try {
    const result = await modelFn({ task, text, dimension });
    return {
      key: dimension.key,
      passed: Boolean(result?.passed),
      reason: result?.reason ?? "",
    };
  } catch (error) {
    return {
      key: dimension.key,
      passed: false,
      reason: error?.message ?? String(error),
    };
  }
}

export async function grade(
  { task, artifact, rubric = RESEARCH_RUBRIC },
  modelFn
) {
  const text =
    typeof artifact === "string" ? artifact : (artifact && artifact.text) || "";
  const rules = ruleCheck(text, rubric);
  const modelResults = [];

  for (const dimension of rubric || []) {
    if (dimension?.kind === "model") {
      modelResults.push(await runModelCheck(task, text, dimension, modelFn));
    }
  }

  const perDimension = rules.checks.concat(modelResults);
  const failed = perDimension
    .filter(dimension => !dimension.passed)
    .map(dimension => dimension.key);
  return {
    passed:
      rules.hardFails === 0 &&
      modelResults.every(dimension => dimension.passed),
    perDimension,
    feedback: failed.length ? failed.join(", ") : "全部通过",
  };
}
