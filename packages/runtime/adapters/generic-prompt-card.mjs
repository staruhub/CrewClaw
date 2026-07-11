import { defineAdapter } from "./adapter-interface.mjs";

const FOOTER =
  "限制：无权限强制 C:/Program Files/Git/ 无工具保证 C:/Program Files/Git/ 无 Outcome 自动验收 C:/Program Files/Git/ 不计为有效任务";

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

function renderValue(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (!hasValue(value)) return [`${pad}- 无`];
  if (typeof value !== "object") return [`${pad}- ${scalar(value)}`];

  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (typeof item === "object" && item !== null) {
        return renderValue(item, indent).map((line, index) =>
          index === 0 ? line : line
        );
      }
      return [`${pad}- ${scalar(item)}`];
    });
  }

  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === "object" && item !== null) {
      return [`${pad}- ${key}:`, ...renderValue(item, indent + 1)];
    }
    return [`${pad}- ${key}: ${scalar(item)}`];
  });
}

function section(title, value) {
  return [`## ${title}`, ...renderValue(value), ""].join("\n");
}

function usageInstructions(pkg) {
  const name = pkg?.identity?.name || pkg?.identity?.id || "该员工";
  return [
    `- 将本 Prompt Card 作为 ${name} 的系统提示或角色说明使用。`,
    "- 任务开始前先确认目标、输入材料、交付格式和验收标准。",
    "- 只能把输出视为 L0 Prompt Card 结果；涉及工具、权限、证据库、Artifact 或 Outcome 验收时，需要迁移到更高兼容等级 Runtime。",
  ];
}

function riskNotes(pkg) {
  const notes = [];
  for (const playbook of pkg?.failure_playbooks || []) {
    const trigger = playbook?.trigger || playbook?.id || "风险";
    const response = playbook?.response || "需人工判断后处理。";
    notes.push(`- ${trigger}: ${response}`);
  }

  const policy = pkg?.permission_policy || {};
  if (
    Array.isArray(policy.human_authorization_required) &&
    policy.human_authorization_required.length > 0
  ) {
    notes.push(
      `- 需要人工授权：${policy.human_authorization_required.join(", ")}。`
    );
  }

  const denied = Object.keys(policy.denied || {});
  if (denied.length > 0) {
    notes.push(`- 禁止自动执行：${denied.sort().join(", ")}。`);
  }

  return notes.length > 0 ? notes : ["- 无额外风险提示。"];
}

export const genericPromptCardAdapter = defineAdapter({
  id: "generic-prompt-card",
  name: "Generic Prompt Card Adapter",
  targetLevel: "L0",

  capabilities() {
    return {
      tools: false,
      shell: false,
      browser: false,
      artifacts: false,
      events: false,
      memory: false,
      doctor: false,
    };
  },

  validate(pkg) {
    const errors = [];
    for (const field of ["identity", "role_contract", "soul"]) {
      if (!hasValue(pkg?.[field]))
        errors.push(`Missing required field: ${field}`);
    }
    return { ok: errors.length === 0, errors };
  },

  compile(pkg) {
    return [
      "# CrewClaw Generic Prompt Card",
      "",
      section("员工身份", pkg?.identity),
      section("岗位合同", pkg?.role_contract),
      section("工作方式", pkg?.soul),
      section("标准交付物", pkg?.deliverables),
      "## 用户使用说明",
      ...usageInstructions(pkg),
      "",
      "## 风险提示",
      ...riskNotes(pkg),
      "",
      FOOTER,
      "",
    ].join("\n");
  },

  runSmokeTest() {
    return { ok: false, reason: "not_supported", level: "L0" };
  },
});

export default genericPromptCardAdapter;
