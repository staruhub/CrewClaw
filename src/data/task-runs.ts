// Shared TaskRun projection types. Production pages obtain these records from the local
// TaskRun API, which safely projects `.crewclaw/runs/<id>.json`. The seed at the end of this
// module is test-only data used by component/browser fixtures; production code must not import
// `getTaskRun` or `getLatestTaskRun` as a runtime fallback.

export type TaskEvent = {
  id: string;
  task_id: string;
  type: string; // "state_changed" | "tool_called" | ...
  summary: string; // human action line (event-summary)
  tool_name: string | null;
  status: string | null;
  timestamp: string;
};

export type ToolInvocation = {
  tool_name: string;
  capability?: string;
  input_summary: string;
  permission_level: string | null;
  decision_source?: string;
  decision: "allow" | "confirm" | "deny";
  status: "success" | "blocked" | "error" | "cancelled";
  /** Runtime audit timestamps are the canonical source for elapsed display. */
  started_at?: string;
  ended_at?: string;
  /** Compatibility field for task runs persisted before audit timestamps existed. */
  elapsed_ms?: number;
  action?: string;
};

export type WorkbenchArtifact = {
  id: string;
  name: string;
  kind:
    | "markdown"
    | "csv"
    | "excel"
    | "docx"
    | "pptx"
    | "code"
    | "json"
    | "unknown";
  path: string | null;
  status:
    | "draft"
    | "ready"
    | "needs_review"
    | "accepted"
    | "rejected"
    | "exported"
    | "deleted";
  summary: string;
  checks: { label: string; status: "passed" | "warning" | "failed" }[];
  preview: string;
};

export type PendingAction = {
  key: string;
  label: string;
  command: string;
};

export type TaskRun = {
  id: string;
  employee_id: string;
  employee_name?: string;
  role?: string;
  model?: string;
  user_goal: string;
  status: string; // created | planned | running_tool | ... | delivered | accepted | rejected | failed
  events: TaskEvent[];
  tool_invocations: ToolInvocation[];
  artifact: string | null;
  artifacts: WorkbenchArtifact[];
  pending_actions: PendingAction[];
  inspect: {
    debug: string[];
    raw_events: string[];
  };
  output_valid?: boolean;
  effective?: boolean;
  user_feedback?: string;
  dream?: { candidates: number; confidence: string };
  cost?: number;
  tokens?: number;
  started_at: string;
  updated_at: string;
  // display-only helpers (the real artifact/report content lives on disk)
  deliverable?: string;
  sources?: string[];
  grade?: { passed: boolean; missing: string[] };
};

const SEED_RUN: TaskRun = {
  id: "task_1719306072000",
  employee_id: "ai-adoption-whale",
  employee_name: "AI 落地鲸",
  role: "企业大模型落地顾问",
  model: "anthropic/claude-opus-4.8",
  user_goal: "调研火山 Seed 2.1，判断是否适合接入 CrewClaw",
  status: "accepted",
  output_valid: true,
  effective: true,
  user_feedback: "useful",
  cost: 0.18,
  tokens: 12840,
  artifact: "artifact_1719306072123",
  artifacts: [
    {
      id: "artifact_1719306072123",
      name: "seed-2.1-research.md",
      kind: "markdown",
      path: ".crewclaw/artifacts/task_1719306072000/seed-2.1-research.md",
      status: "accepted",
      summary: "官方名称、价格、上下文、能力和接入建议。",
      checks: [
        { label: "官方来源已标注", status: "passed" },
        { label: "价格需上线前复核", status: "warning" },
        { label: "输出结构完整", status: "passed" },
      ],
      preview: [
        "Doubao-Seed-2.1 是火山引擎 Seed 2.1 系列模型。",
        "适合作为 CrewClaw 研究/选型场景候选，建议先灰度。",
        "关键假设：价格和上下文以官方页面最终口径为准。",
      ].join("\n"),
    },
    {
      id: "artifact_1719306072456",
      name: "seed-2.1-evidence.json",
      kind: "json",
      path: ".crewclaw/artifacts/task_1719306072000/evidence.json",
      status: "ready",
      summary: "结构化来源、置信度和验收结果。",
      checks: [
        { label: "包含来源 URL", status: "passed" },
        { label: "包含置信度", status: "passed" },
      ],
      preview: '{\n  "confidence": "high",\n  "source": "volcengine.com"\n}',
    },
  ],
  pending_actions: [
    { key: "1", label: "接受交付物", command: "accept_artifact" },
    { key: "2", label: "要求复核价格", command: "revise_pricing" },
    { key: "3", label: "导出报告", command: "export_report" },
  ],
  inspect: {
    debug: [
      "engine stderr captured in Inspect, not alternate screen",
      "tool web_fetch latency=1240ms status=success",
      "artifact.write path=.crewclaw/artifacts/task_1719306072000/seed-2.1-research.md",
    ],
    raw_events: [
      "task.started",
      "tool.requested",
      "artifact.created",
      "outcome.checked",
      "task.completed",
    ],
  },
  dream: { candidates: 3, confidence: "high" },
  started_at: "2026-06-25T09:00:00.000Z",
  updated_at: "2026-06-25T09:01:12.000Z",
  events: [
    {
      id: "evt_1",
      task_id: "task_1719306072000",
      type: "state_changed",
      summary: "制定研究计划",
      tool_name: null,
      status: null,
      timestamp: "2026-06-25T09:00:01.000Z",
    },
    {
      id: "evt_2",
      task_id: "task_1719306072000",
      type: "tool_called",
      summary: "正在搜索来源：site:volcengine.com Seed 2.1 定价",
      tool_name: "web_search",
      status: "success",
      timestamp: "2026-06-25T09:00:09.000Z",
    },
    {
      id: "evt_3",
      task_id: "task_1719306072000",
      type: "tool_called",
      summary: "正在阅读 www.volcengine.com",
      tool_name: "web_fetch",
      status: "success",
      timestamp: "2026-06-25T09:00:24.000Z",
    },
    {
      id: "evt_4",
      task_id: "task_1719306072000",
      type: "tool_called",
      summary: "已拦截越权操作：write_crm",
      tool_name: "write_crm",
      status: "blocked",
      timestamp: "2026-06-25T09:00:38.000Z",
    },
    {
      id: "evt_5",
      task_id: "task_1719306072000",
      type: "state_changed",
      summary: "提取证据，交叉验证官方来源",
      tool_name: null,
      status: null,
      timestamp: "2026-06-25T09:00:52.000Z",
    },
    {
      id: "evt_6",
      task_id: "task_1719306072000",
      type: "state_changed",
      summary: "通过验收，交付",
      tool_name: null,
      status: null,
      timestamp: "2026-06-25T09:01:10.000Z",
    },
  ],
  tool_invocations: [
    {
      tool_name: "web_search",
      capability: "web.search",
      input_summary: "site:volcengine.com Seed 2.1 定价",
      permission_level: "L0",
      decision: "allow",
      decision_source: "employee_policy",
      status: "success",
      started_at: "2026-06-25T09:00:01.100Z",
      ended_at: "2026-06-25T09:00:01.942Z",
      action: "正在搜索来源：Seed 2.1 定价",
    },
    {
      tool_name: "web_fetch",
      capability: "web.fetch_extract",
      input_summary: "https://www.volcengine.com/product/ark",
      permission_level: "L0",
      decision: "allow",
      decision_source: "employee_policy",
      status: "success",
      started_at: "2026-06-25T09:00:02.100Z",
      ended_at: "2026-06-25T09:00:03.294Z",
      action: "正在阅读 www.volcengine.com",
    },
    {
      tool_name: "write_crm",
      capability: "crm.write",
      input_summary: "把联系人写入 CRM",
      permission_level: "L3",
      decision: "deny",
      decision_source: "employee_policy",
      status: "blocked",
      started_at: "2026-06-25T09:00:03.350Z",
      ended_at: "2026-06-25T09:00:03.350Z",
      action: "已拦截越权操作：write_crm",
    },
  ],
  sources: ["https://www.volcengine.com/product/ark"],
  grade: { passed: true, missing: [] },
  deliverable: [
    "## 官方名称",
    "Doubao-Seed-2.1（火山引擎 Seed 2.1 系列）。",
    "",
    "## 价格",
    "输入约 6 元 / 输出约 30 元（每百万 token，以官方为准）。",
    "",
    "## 上下文",
    "256k token。",
    "",
    "## 能力",
    "Coding、Agent、推理、多模态。",
    "",
    "## 来源",
    "https://www.volcengine.com/product/ark （官方文档，交叉验证）。",
    "",
    "## 置信度",
    "高。",
    "",
    "## 建议",
    "推荐作为选型候选之一接入 CrewClaw，先在研究/选型场景灰度。",
  ].join("\n"),
};

const RUNS: Record<string, TaskRun> = {
  [SEED_RUN.id]: SEED_RUN,
  latest: SEED_RUN,
};

export function getTaskRun(id: string): TaskRun | null {
  return RUNS[id] ?? null;
}

export function getLatestTaskRun(): TaskRun {
  return SEED_RUN;
}
