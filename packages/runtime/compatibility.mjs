export const RUNTIME_LEVELS = Object.freeze({
  L0: Object.freeze({
    name: "Prompt Card",
    meaning: "只能导出角色设定和工作方式；不能运行或强制工具。",
  }),
  L1: Object.freeze({
    name: "Playbook Pack",
    meaning: "能导出技能、流程、交付模板，但工具不可强执行。",
  }),
  L2: Object.freeze({
    name: "Runnable Employee",
    meaning: "能运行任务、调用工具、产出基础 Artifact。",
  }),
  L3: Object.freeze({
    name: "Managed Employee",
    meaning: "有权限、事件、日志、记忆、Doctor、基础验收。",
  }),
  L4: Object.freeze({
    name: "Native CrewClaw/OpenWork Employee",
    meaning:
      "完整 Hire、Onboard、Workbench、Permission、Artifact、Outcome、Dream、评分闭环。",
  }),
});

const L2_RUNTIME_CAPABILITIES = [
  ["tasks", "task", "task_runner", "runTasks"],
  ["tools", "tool_runtime"],
  ["artifact", "artifacts", "basic_artifact"],
];

const L3_RUNTIME_CAPABILITIES = [
  ["permissions", "permission"],
  ["events", "event"],
  ["logs", "logging"],
  ["memory"],
  ["doctor"],
  ["basic_acceptance", "basicAcceptance", "acceptance"],
];

const L4_RUNTIME_CAPABILITIES = [
  ["hire"],
  ["onboard", "onboarding"],
  ["workbench"],
  ["permissions", "permission"],
  ["artifact", "artifacts"],
  ["outcome", "outcomes"],
  ["dream", "dream_loop", "dreamLoop"],
];

function truthy(value) {
  return (
    value === true ||
    value === "true" ||
    value === "yes" ||
    value === "supported"
  );
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (value instanceof Set) return [...value].map(String);
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(
        ([, supported]) => truthy(supported) || typeof supported === "object"
      )
      .map(([name]) => name);
  }
  return [];
}

function capabilitySet(runtimeCapabilities = {}) {
  return new Set(
    [
      ...normalizeList(runtimeCapabilities.capabilities),
      ...normalizeList(runtimeCapabilities.supportedCapabilities),
      ...normalizeList(runtimeCapabilities.tools),
      ...normalizeList(runtimeCapabilities.toolCapabilities),
    ].sort()
  );
}

function categoryFor(capability) {
  if (/^(web\.search|web\.extract|web\.fetch_extract)$/.test(capability))
    return "search";
  if (/^browser\./.test(capability)) return "browser";
  if (/^(evidence\.|source\.)/.test(capability)) return "evidence";
  if (/^artifact\./.test(capability)) return "artifact";
  if (/^shell\./.test(capability)) return "shell";
  if (/^(file|fs)\./.test(capability)) return "file";
  return capability.split(".")[0];
}

function hasAny(runtimeCapabilities, names) {
  return names.some(name => truthy(runtimeCapabilities?.[name]));
}

function hasRuntimeCapability(runtimeCapabilities, caps, capability) {
  if (caps.has(capability) || truthy(runtimeCapabilities?.[capability]))
    return true;

  const category = categoryFor(capability);
  if (truthy(runtimeCapabilities?.[category])) return true;
  if (category === "artifact" && truthy(runtimeCapabilities?.artifacts))
    return true;
  if (category === "evidence" && truthy(runtimeCapabilities?.source))
    return true;
  if (category === "search" && truthy(runtimeCapabilities?.web)) return true;

  return false;
}

function collectRuntimeRequirements(pkg) {
  const requirements = pkg?.runtime_requirements || {};
  const disabled = new Set(
    (requirements.disabled_capabilities || []).map(String)
  );
  const required = new Set((requirements.capabilities || []).map(String));
  const optional = new Set(
    (requirements.optional_capabilities || []).map(String)
  );

  for (const [capability, need] of Object.entries(pkg?.tool_needs || {})) {
    const necessity = String(need?.necessity || "").toLowerCase();
    if (necessity === "disabled") disabled.add(capability);
    if (necessity === "required") required.add(capability);
    if (
      necessity === "conditional" ||
      necessity === "optional" ||
      necessity === "non_default"
    ) {
      optional.add(capability);
    }
  }

  for (const capability of disabled) {
    required.delete(capability);
    optional.delete(capability);
  }

  return {
    required: [...required].sort(),
    optional: [...optional].sort(),
    disabled: [...disabled].sort(),
  };
}

function missingPackageCapabilities(pkg, runtimeCapabilities, caps) {
  const { required } = collectRuntimeRequirements(pkg);
  return required.filter(
    capability => !hasRuntimeCapability(runtimeCapabilities, caps, capability)
  );
}

function missingRuntimeCapabilityGroups(runtimeCapabilities, groups) {
  return groups
    .filter(group => !hasAny(runtimeCapabilities, group))
    .map(group => group[0]);
}

export function computeCompatibility(pkg, runtimeCapabilities = {}) {
  const caps = capabilitySet(runtimeCapabilities);
  const requirements = collectRuntimeRequirements(pkg);
  const reasons = [];

  if (runtimeCapabilities?.tools === false) {
    reasons.push(
      "downgrade to L0: runtimeCapabilities.tools is false, so tools cannot run at all"
    );
    if (requirements.required.length > 0) {
      reasons.push(
        `downgrade to L0: required package capabilities cannot be enforced: ${requirements.required.join(", ")}`
      );
    }
    return { level: "L0", reasons };
  }

  const missingRequired = missingPackageCapabilities(
    pkg,
    runtimeCapabilities,
    caps
  );
  if (missingRequired.length > 0) {
    for (const capability of missingRequired) {
      reasons.push(
        `downgrade below L2: missing required package capability ${capability}`
      );
    }
    return { level: "L1", reasons };
  }

  const missingL2 = missingRuntimeCapabilityGroups(
    runtimeCapabilities,
    L2_RUNTIME_CAPABILITIES
  );
  if (missingL2.length > 0) {
    for (const capability of missingL2) {
      reasons.push(`downgrade below L2: runtime lacks ${capability}`);
    }
    return { level: "L1", reasons };
  }

  const missingL3 = missingRuntimeCapabilityGroups(
    runtimeCapabilities,
    L3_RUNTIME_CAPABILITIES
  );
  if (missingL3.length > 0) {
    for (const capability of missingL3) {
      reasons.push(`downgrade below L3: runtime lacks ${capability}`);
    }
    return { level: "L2", reasons };
  }

  const missingL4 = missingRuntimeCapabilityGroups(
    runtimeCapabilities,
    L4_RUNTIME_CAPABILITIES
  );
  if (missingL4.length > 0) {
    for (const capability of missingL4) {
      reasons.push(`downgrade below L4: runtime lacks ${capability}`);
    }
    return { level: "L3", reasons };
  }

  return { level: "L4", reasons };
}
