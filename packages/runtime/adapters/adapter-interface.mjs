export const ADAPTER_METHODS = Object.freeze([
  "detect",
  "capabilities",
  "validate",
  "compile",
  "install",
  "doctor",
  "runSmokeTest",
  "collectEvents",
  "collectArtifacts",
  "uninstall",
]);

export const ADAPTER_CONTRACT = Object.freeze({
  detect: "检测目标 Runtime 是否存在、版本是否满足。",
  capabilities: "返回目标 Runtime 支持的能力。",
  validate: "判断 Employee Package 能否部署。",
  compile: "把员工包编译成目标配置。",
  install: "安装员工。",
  doctor: "检查安装结果。",
  runSmokeTest: "跑第一项试岗任务。",
  collectEvents: "收集任务事件。",
  collectArtifacts: "收集交付物。",
  uninstall: "卸载或停用员工。",
});

function notSupported() {
  return { ok: false, reason: "not_supported" };
}

const DEFAULT_METHODS = Object.freeze({
  detect: notSupported,
  capabilities: notSupported,
  validate: notSupported,
  compile: notSupported,
  install: notSupported,
  doctor: notSupported,
  runSmokeTest: notSupported,
  collectEvents: notSupported,
  collectArtifacts: notSupported,
  uninstall: notSupported,
});

export function defineAdapter(impl = {}) {
  const adapter = {};
  for (const method of ADAPTER_METHODS) {
    adapter[method] = typeof impl[method] === "function" ? impl[method] : DEFAULT_METHODS[method];
  }

  for (const [key, value] of Object.entries(impl)) {
    if (!(key in adapter)) adapter[key] = value;
  }

  return Object.freeze(adapter);
}
