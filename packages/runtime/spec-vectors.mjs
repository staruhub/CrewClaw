import { classifyIntent } from "./router.mjs";
import { getMemoryTruth, memoryCommandResponse } from "./memory-harness.mjs";
import { STATUS, getToolTruth } from "./tool-truth.mjs";

export const SPEC_VECTORS = Object.freeze([
  {
    id: 1,
    label: "light greeting",
    input: "hi",
    expect: { route: "employee_chat", loadsFullContext: false },
  },
  {
    id: 2,
    label: "weather quick utility",
    input: "杭州天气",
    expect: { route: "quick_utility", scored: false },
  },
  {
    id: 3,
    label: "latest model releases require search",
    input: "最新有哪些模型发布",
    expect: {
      route: "employee_task",
      needsSearch: true,
      blockedWhenNoKey: true,
    },
  },
  {
    id: 4,
    label: "internal QA ROI upgrades to task",
    input: "给我一份内部知识问答ROI示例",
    expect: { route: "employee_task", upgrade: true },
  },
  {
    id: 5,
    label: "bare numeric pending action",
    input: "1",
    expect: { matchesPendingActionFirst: true },
  },
  {
    id: 6,
    label: "memory command truth",
    input: "jizhu",
    expect: { route: "memory_command", noFalsePersistentClaim: true },
  },
  {
    id: 7,
    label: "markdown artifact required",
    input: "输出一份markdown",
    expect: { route: "artifact_action", requiresArtifactObject: true },
  },
  {
    id: 8,
    label: "reveal artifact without bare bash",
    input: "打开文件夹",
    expect: { route: "artifact_action", noBareBash: true },
  },
  {
    id: 9,
    label: "js shell page requires render",
    input: { type: "js_shell", code: "console.log(42)" },
    expect: { requiresRender: true },
  },
  {
    id: 10,
    label: "task end enters approval",
    input: { type: "task_end" },
    expect: { entersApprovalNotDone: true },
  },
]);

export const HOST_SPEC = Object.freeze([
  {
    id: "CC-SCOPE-001",
    desc: "Employees must declare job boundaries and delegation scope.",
  },
  { id: "CC-CHAT-001", desc: "Formal tasks in chat must upgrade to TaskRun." },
  { id: "CC-ART-001", desc: "No Artifact, No Done." },
  { id: "CC-TOOL-001", desc: "Tool readiness must be truthful." },
  { id: "CC-MEM-001", desc: "Memory state must be truthful." },
  {
    id: "CC-EVID-001",
    desc: "Research conclusions must bind to Evidence Cards.",
  },
  {
    id: "CC-ACT-001",
    desc: "Bare numeric input must match PendingAction before model inference.",
  },
  {
    id: "CC-SAFE-001",
    desc: "High-risk actions require explicit confirmation.",
  },
  { id: "CC-BUDGET-001", desc: "Tasks must have soft and hard budgets." },
  { id: "CC-PROOF-001", desc: "Trial Tasks must generate ProofPack." },
]);

const HOST_ONLY_EXPECTATIONS = Object.freeze({
  upgrade:
    "TaskRun creation and report/table artifact production require host orchestration.",
  requiresArtifactObject:
    "Artifact object creation and artifact.created emission require host orchestration.",
  noBareBash:
    "Reveal/open-folder dispatch must be checked at the workspace or OS adapter boundary.",
  requiresRender:
    "requires_render is emitted by the web extraction/render pipeline, not this pure module harness.",
  entersApprovalNotDone:
    "Approval state is decided by the TaskRun outcome state machine.",
  matchesPendingActionFirst:
    "PendingAction precedence is a host dispatch contract before model inference.",
});

export async function runSpecVector(vector, ctx = {}) {
  const checks = [];
  const pending = [];
  const expect = vector?.expect ?? {};
  const env = ctx.env ?? {};
  const input = vector?.input;
  const textInput = typeof input === "string" ? input : undefined;
  const intent = textInput ? classifyIntent(textInput, ctx) : undefined;

  if ("route" in expect) {
    const actualRoute = intent?.type;
    addCheck(
      checks,
      "route",
      actualRoute === expect.route,
      `expected ${expect.route}, got ${actualRoute}; classifyIntent=${intent?.type ?? "n/a"}`
    );
  }

  if ("loadsFullContext" in expect) {
    const loadsFullContext = intent?.type === "employee_task";
    addCheck(
      checks,
      "loadsFullContext",
      loadsFullContext === expect.loadsFullContext,
      `expected ${expect.loadsFullContext}, got ${loadsFullContext}`
    );
  }

  if ("scored" in expect) {
    const scored = intent?.type === "employee_task";
    addCheck(
      checks,
      "scored",
      scored === expect.scored,
      `expected ${expect.scored}, got ${scored}`
    );
  }

  if ("needsSearch" in expect || "blockedWhenNoKey" in expect) {
    const states = getToolTruth(env);
    const searchState = findCapability(states, "web.search");

    if ("needsSearch" in expect) {
      addCheck(
        checks,
        "needsSearch",
        Boolean(searchState) === expect.needsSearch,
        searchState
          ? `web.search status=${searchState.status}`
          : "web.search capability missing from Tool Truth"
      );
    }

    if ("blockedWhenNoKey" in expect) {
      addCheck(
        checks,
        "blockedWhenNoKey",
        (searchState?.status === STATUS.missing_key) ===
          expect.blockedWhenNoKey,
        `web.search status=${searchState?.status ?? "missing"}`
      );
    }
  }

  if ("noFalsePersistentClaim" in expect) {
    const truth = getMemoryTruth(env);
    const response = memoryCommandResponse(textInput, env);
    const falseClaim =
      truth.persistent !== "available" &&
      /长期|持久|persistent/i.test(response.note);

    addCheck(
      checks,
      "noFalsePersistentClaim",
      !falseClaim === expect.noFalsePersistentClaim,
      `persistent=${truth.persistent}; note=${response.note}`
    );
  }

  for (const [key, detail] of Object.entries(HOST_ONLY_EXPECTATIONS)) {
    if (expect[key] === true) {
      pending.push(`${key}: ${detail}`);
    }
  }

  return {
    id: vector?.id,
    pass: checks.every(check => check.ok),
    checks,
    pending,
  };
}

function addCheck(checks, name, ok, detail) {
  checks.push({ name, ok, detail });
}

function findCapability(states, capability) {
  return states.find(state => state.capability === capability);
}
