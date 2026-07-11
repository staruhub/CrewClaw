import { computeCompatibility } from "./compatibility.mjs";
import { validateEmployeePackage } from "./employee-package.mjs";
import { getToolStatus } from "./tui/tool-status.mjs";

const LEVEL_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 });

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function doctorResult({
  status,
  checks = [],
  missing = [],
  impact = "",
  fixes = [],
  allow_degrade = false,
  degraded_level = null,
}) {
  return {
    status,
    checks,
    missing: [...new Set(missing.filter(Boolean))],
    impact,
    fixes: [...new Set(fixes.filter(Boolean))],
    allow_degrade,
    degraded_level,
  };
}

function validationFix(error) {
  const missing = String(error).match(/^Missing required field:\s*(.+)$/i);
  if (missing) return `补齐员工包必填字段 ${missing[1]}`;
  return `修正员工包校验问题：${error}`;
}

function toolFix(tool, code) {
  if (tool === "web.search" && code === "missing_key") {
    return "配置 Tavily/Firecrawl/Exa/Brave/SearXNG 任一稳定 Search Provider";
  }
  if (tool === "browser.render") {
    return "安装并配置 Playwright，或接入 Firecrawl/Browserbase 渲染 provider";
  }
  if (tool.startsWith("artifact."))
    return `配置 ${tool} 的 Artifact 写入目录和权限`;
  if (tool.startsWith("evidence.") || tool === "source.verify")
    return `配置 ${tool} 的证据库读写能力`;
  return `为 Runtime 配置必需工具 ${tool}`;
}

function capabilityRuntimeTool(capability) {
  if (capability === "web.search") return "web.search";
  if (capability === "browser.render") return "browser.render";
  if (capability === "web.extract" || capability === "web.fetch_extract")
    return "web.fetch";
  if (capability === "source.verify" || capability.startsWith("evidence."))
    return "evidence";
  return capability;
}

function capabilityAvailable(capability, statusByTool) {
  const direct = statusByTool.get(capability);
  if (direct) return direct;
  const mapped = statusByTool.get(capabilityRuntimeTool(capability));
  if (mapped) return mapped;
  if (capability.startsWith("artifact.")) {
    return {
      tool: capability,
      ok: true,
      label: "assumed",
      reason: "",
      code: "",
    };
  }
  return {
    tool: capability,
    ok: false,
    label: "not declared",
    reason: `${capability} 未由当前 Runtime tool status 声明`,
    code: "missing_tool",
  };
}

function packageToolEntries(pkg) {
  return Object.entries(pkg?.tool_needs || {}).map(([capability, need]) => ({
    capability,
    necessity: String(need?.necessity || "").toLowerCase(),
    permission: String(need?.permission || "").toLowerCase(),
  }));
}

function isResearchEmployee(pkg) {
  const tools = new Set(Object.keys(pkg?.tool_needs || {}));
  const text = [
    pkg?.identity?.title,
    pkg?.identity?.description,
    pkg?.role_contract?.title,
    pkg?.role_contract?.mission,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    tools.has("web.search") ||
    tools.has("source.verify") ||
    /research|调研|研究/.test(text)
  );
}

function compatibilityFix(reason) {
  const text = String(reason);
  const missingPackage = text.match(
    /missing required package capability\s+(.+)$/i
  );
  if (missingPackage)
    return `为目标 Runtime 接入必需 capability：${missingPackage[1]}`;
  const runtimeLacks = text.match(/runtime lacks\s+(.+)$/i);
  if (runtimeLacks) return `启用目标 Runtime 的 ${runtimeLacks[1]} 能力`;
  if (/tools is false/i.test(text))
    return "启用 Runtime 工具执行能力，或选择支持工具调用的 Runtime";
  if (/cannot be enforced/i.test(text))
    return "部署到能强制执行员工包必需工具的 Runtime";
  return `处理兼容性降级原因：${reason}`;
}

function permissionPolicyChecks(pkg) {
  const policy = pkg?.permission_policy || {};
  const checks = [];
  const missing = [];
  const fixes = [];

  const defaultLevel = String(policy.default_level || "").trim();
  const p4Default = defaultLevel === "P4";
  checks.push({
    name: "permission_policy.default_level",
    ok: !p4Default,
    detail: p4Default
      ? "permission_policy default_level 不能默认允许 P4 高危权限"
      : "未默认允许 P4 高危权限",
  });
  if (p4Default) {
    missing.push(
      "将 permission_policy.default_level 调整为 P0/P1，并让 P4 动作默认禁止"
    );
    fixes.push("把 P4 外部副作用动作放入 denied，并要求人工确认");
  }

  const denied =
    policy.denied && typeof policy.denied === "object"
      ? Object.keys(policy.denied)
      : [];
  const grants =
    policy.grants && typeof policy.grants === "object" ? policy.grants : {};
  const riskyGranted = Object.entries(grants)
    .filter(([, level]) => String(level).trim() === "P4")
    .map(([tool]) => tool);
  const highRiskDisabled = riskyGranted.length === 0 && denied.length > 0;
  checks.push({
    name: "permission_policy.high_risk_tools",
    ok: highRiskDisabled,
    detail: highRiskDisabled
      ? `高危工具已通过 denied 声明：${denied.join(", ")}`
      : "P4 高危工具必须默认禁止，不能直接 grant",
  });
  if (!highRiskDisabled) {
    missing.push(
      "在 permission_policy.denied 中列出 notify/email/payments/production.deploy 等外部副作用工具"
    );
    fixes.push(
      "删除 P4 grant，把外发、付款、采购、生产部署改为 denied + human authorization"
    );
  }

  return { checks, missing, fixes };
}

export function packageDoctor(pkg) {
  const validation = validateEmployeePackage(pkg);
  const evalPresent = hasValue(pkg?.eval_suite);
  const checks = [
    {
      name: "package.validation",
      ok: validation.ok,
      detail: validation.ok
        ? "员工包完整性和字段合法性通过"
        : validation.errors.join("; "),
    },
    {
      name: "package.eval_suite",
      ok: evalPresent,
      detail: evalPresent
        ? "eval_suite 已声明"
        : "缺少 eval_suite，无法做上架前验收",
    },
  ];
  const errors = [...(validation.errors || [])];
  if (!evalPresent && !errors.some(error => /eval_suite/.test(error))) {
    errors.push("Missing required field: eval_suite");
  }

  return doctorResult({
    status: validation.ok && evalPresent ? "healthy" : "broken",
    checks,
    missing: errors.map(validationFix),
    impact:
      validation.ok && evalPresent
        ? "员工包可进入部署前兼容性检查。"
        : "员工包不能上架；字段、权限或 eval 缺口会让后续部署和验收失真。",
    fixes:
      errors.length > 0
        ? errors.map(validationFix)
        : [
            "保持 eval_suite 与 outcome_rubric 同步，变更员工职责后重新运行 Package Doctor",
          ],
    allow_degrade: false,
    degraded_level: null,
  });
}

export function compatibilityDoctor(pkg, runtimeCapabilities = {}) {
  const compatibility = computeCompatibility(pkg, runtimeCapabilities);
  const rank = LEVEL_RANK[compatibility.level] ?? 0;
  const research = isResearchEmployee(pkg);
  const status =
    rank >= 3 ? "healthy" : rank === 0 && research ? "broken" : "warning";
  const checks =
    compatibility.reasons.length > 0
      ? compatibility.reasons.map((reason, index) => ({
          name: `compatibility.reason.${index + 1}`,
          ok: false,
          detail: reason,
        }))
      : [
          {
            name: "compatibility.level",
            ok: true,
            detail: `目标 Runtime 可承载到 ${compatibility.level}`,
          },
        ];
  const fixes =
    compatibility.reasons.length > 0
      ? compatibility.reasons.map(compatibilityFix)
      : ["保持目标 Runtime 的工具、权限、事件、日志和验收能力可用"];

  return doctorResult({
    status,
    checks,
    missing: compatibility.reasons.map(compatibilityFix),
    impact:
      rank >= 3
        ? `目标 Runtime 可达到 ${compatibility.level}，满足 Managed Employee 入职要求。`
        : `目标 Runtime 只能达到 ${compatibility.level}；研究员工无法保证工具强制执行、证据链或正式验收。`,
    fixes,
    allow_degrade: rank < 3,
    degraded_level: rank < 3 ? compatibility.level : null,
  });
}

export function onboardingDoctor(pkg, env = process.env) {
  const toolStatus = getToolStatus(env);
  const statusByTool = new Map(toolStatus.map(status => [status.tool, status]));
  const checks = [];
  const missing = [];
  const fixes = [];
  let hasRequiredFailure = false;
  let hasOptionalFailure = false;

  for (const entry of packageToolEntries(pkg)) {
    if (entry.necessity === "disabled") {
      checks.push({
        name: `tool.${entry.capability}`,
        ok: true,
        detail: `${entry.capability} 已声明 disabled，不应在入职时启用`,
      });
      continue;
    }

    const actual = capabilityAvailable(entry.capability, statusByTool);
    const ok = Boolean(actual.ok);
    const required = entry.necessity === "required";
    if (!ok && required) hasRequiredFailure = true;
    if (!ok && !required) hasOptionalFailure = true;
    const code = actual.code ? ` code=${actual.code}` : "";
    checks.push({
      name: `tool.${entry.capability}`,
      ok: ok || !required,
      detail: ok
        ? `${entry.capability} 可用：${actual.label || "ok"}`
        : `${entry.capability} 不可用：${actual.reason || "missing tool"}${code}`,
    });
    if (!ok) {
      const fix = toolFix(entry.capability, actual.code);
      if (required) missing.push(fix);
      fixes.push(fix);
    }
  }

  const permissions = permissionPolicyChecks(pkg);
  checks.push(...permissions.checks);
  missing.push(...permissions.missing);
  fixes.push(...permissions.fixes);

  checks.push({
    name: "model.budget",
    ok: true,
    detail: "当前员工包未声明强制模型或预算字段，入职阶段不阻塞",
  });

  const permissionBroken = permissions.checks.some(check => !check.ok);
  const status =
    hasRequiredFailure || permissionBroken
      ? "broken"
      : hasOptionalFailure
        ? "warning"
        : "healthy";
  const searchMissing = checks.some(
    check => check.name === "tool.web.search" && !check.ok
  );

  return doctorResult({
    status,
    checks,
    missing,
    impact: searchMissing
      ? "不能进入正式研究模式；缺 Search Provider 时只能输出需核实的初步判断，不计为有效任务。"
      : status === "healthy"
        ? "工具、权限和凭证满足入职前置检查，可进入正式任务。"
        : "部分非必需工具不可用，任务可继续但相关 fallback 能力会受限。",
    fixes:
      fixes.length > 0
        ? fixes
        : [
            "保持 Search Provider、证据库和权限策略可用，任务开始前重跑 Onboarding Doctor",
          ],
    allow_degrade: searchMissing || hasOptionalFailure,
    degraded_level: searchMissing ? "L0" : hasOptionalFailure ? "L2" : null,
  });
}

export function runtimeDoctor(taskRun = {}) {
  const checks = [];
  const missing = [];
  const fixes = [];

  const toolFailures = Array.isArray(taskRun.tool_failures)
    ? taskRun.tool_failures
    : [];
  const toolOk = toolFailures.length === 0;
  checks.push({
    name: "runtime.tool_failures",
    ok: toolOk,
    detail: toolOk
      ? "任务中没有记录工具失败"
      : `任务中有 ${toolFailures.length} 个工具失败：${toolFailures.map(failure => failure.tool || failure).join(", ")}`,
  });
  if (!toolOk) {
    missing.push(
      "重试失败工具或切换 provider，并把失败 URL/工具调用加入诊断记录"
    );
    fixes.push("检查失败工具的 key、网络、权限和 provider 配置后重跑相关步骤");
  }

  const cost = Number(taskRun.cost ?? 0);
  const budget = Number(taskRun.budget ?? 0);
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const costOk = !hasBudget || cost <= budget;
  checks.push({
    name: "runtime.cost_budget",
    ok: costOk,
    detail: costOk
      ? `成本 ${cost} 未超过预算 ${hasBudget ? budget : "未设置"}`
      : `成本 ${cost} 超过预算 ${budget}`,
  });
  if (!costOk) {
    missing.push("暂停继续调用高成本工具，调整预算或降低模型/搜索深度后再继续");
    fixes.push(
      "设置更低成本的模型路由、减少 max_searches，或申请更高预算后恢复任务"
    );
  }

  const stuckOk = !taskRun.stuck;
  checks.push({
    name: "runtime.stuck",
    ok: stuckOk,
    detail: stuckOk ? "任务未报告卡住" : "任务报告卡住，需要人工介入或改写计划",
  });
  if (!stuckOk) {
    missing.push("人工确认下一步计划，或把任务拆成更小的可验证步骤");
    fixes.push("重写 Search Planner/任务计划，并记录卡住原因后继续");
  }

  const evidenceCount = Number(taskRun.evidence_count ?? 0);
  const evidenceOk = Number.isFinite(evidenceCount) && evidenceCount >= 2;
  checks.push({
    name: "runtime.evidence_count",
    ok: evidenceOk,
    detail: evidenceOk
      ? `证据数量 ${evidenceCount} 满足最低要求`
      : `证据数量 ${evidenceCount} 少于最低要求 2`,
  });
  if (!evidenceOk) {
    missing.push("补充至少 2 条可核验来源证据，并绑定到最终结论");
    fixes.push("继续搜索官方或权威来源，生成 evidence card 后再提交交付物");
  }

  const broken = checks.some(check => !check.ok);
  return doctorResult({
    status: broken ? "warning" : "healthy",
    checks,
    missing,
    impact: broken
      ? "当前任务产物不应直接计为有效任务，需要先处理运行期风险。"
      : "任务运行指标满足基础健康检查。",
    fixes:
      fixes.length > 0
        ? fixes
        : ["保留 cost、events、evidence 和 artifact 记录用于验收"],
    allow_degrade: broken,
    degraded_level: broken ? "L2" : null,
  });
}
