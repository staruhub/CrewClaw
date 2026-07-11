// The shared v0.6 Intent/Scope routing (used by both Ink + Ratatui renderers). Classifies a
// user message and drives the TaskRun via events. Fakes the model turn + captures events.
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { routeTurn, markdownTableToCsv } from "../tui/route.mjs";
import { assertCreated } from "../artifact-contract.mjs";
import { captureArtifactFingerprint } from "../acceptance-transaction.mjs";
import { EVENTS } from "../tui/protocol.mjs";

function harness(extra = {}) {
  const events = [],
    turns = [];
  return {
    events,
    turns,
    emit: (type, data) => events.push({ type, data }),
    runModelTurn: async msg => {
      turns.push(msg);
    },
    has: type => events.some(e => e.type === type),
    ...extra,
  };
}

// 1) employee_task → upgrade to TaskRun + run the model turn
{
  const h = harness();
  const d = await routeTurn("给我一份内部知识问答 ROI 示例报告", {
    emit: h.emit,
    runModelTurn: h.runModelTurn,
  });
  assert.equal(d.type, "employee_task");
  assert.ok(
    h.has(EVENTS.TASK_UPGRADED_FROM_CHAT),
    "formal task upgrades to a TaskRun (not a chat reply)"
  );
  assert.equal(h.turns.length, 1, "runs the model turn");
}

// 2) quick_utility 分流（v0.11 修订）：
//    时间/换算等自包含问题 → LIGHT path（§10.2，无员工上下文）；
//    天气问但卡片答不了（没城市/太远/源挂）→ 全上下文模型轮（"明天天气呢"这类省略城市的
//    追问只有带历史的模型接得住——轻路径无历史会反问哪个城市，实测用户卡点）。
{
  const events = [],
    full = [],
    light = [];
  const d = await routeTurn("现在几点了", {
    emit: (t, dd) => events.push({ type: t, data: dd }),
    runModelTurn: async m => {
      full.push(m);
    },
    runQuickUtility: async m => {
      light.push(m);
    },
    fetchWeather: async () => null,
  });
  assert.equal(d.type, "quick_utility");
  assert.ok(
    events.some(e => e.type === EVENTS.QUICK_UTILITY),
    "time routes to Quick Utility (un-scored)"
  );
  assert.equal(
    light.length,
    1,
    "self-contained quick utility uses the LIGHT path (§10.2)"
  );
  assert.equal(
    full.length,
    0,
    "self-contained quick utility does NOT run the full employee turn"
  );
}
{
  const events = [],
    full = [],
    light = [];
  await routeTurn("明天天气呢", {
    emit: (t, dd) => events.push({ type: t, data: dd }),
    runModelTurn: async m => {
      full.push(m);
    },
    runQuickUtility: async m => {
      light.push(m);
    },
    fetchWeather: async () => null, // 没城市 → 卡片答不了
  });
  assert.equal(
    full.length,
    1,
    "weather ask the card can't answer runs the FULL model turn (history-aware)"
  );
  assert.equal(
    light.length,
    0,
    "weather fallback must NOT use the context-less light path"
  );
}

// 2b) Weather Card (§5.3): a 天气 query fetches a STRUCTURED card → QUICK_UTILITY result, no model
{
  const events = [],
    light = [];
  await routeTurn("杭州天气怎么样", {
    emit: (t, dd) => events.push({ type: t, data: dd }),
    runModelTurn: async () => {},
    runQuickUtility: async m => {
      light.push(m);
    },
    fetchWeather: async city => ({
      city,
      condition: "多云",
      temp_c: 20,
      feels_c: 19,
      humidity: 60,
      source: "wttr.in",
    }),
  });
  const qu = events.filter(e => e.type === EVENTS.QUICK_UTILITY).pop();
  assert.ok(
    qu && qu.data.result,
    "a weather query emits a Quick Utility with a structured result card"
  );
  assert.equal(qu.data.result.condition, "多云");
  assert.equal(qu.data.result.temp_c, 20);
  assert.equal(
    light.length,
    0,
    "a successful weather card does NOT run the model"
  );
  assert.ok(
    events.some(e => e.type === EVENTS.TOKEN_DELTA && /多云/.test(e.data.text)),
    "a text summary accompanies the card"
  );
}

// 3) memory_command → memory truth, NO model turn (memory is a tool, not a sentence)
{
  const h = harness();
  const d = await routeTurn("jizhu", {
    emit: h.emit,
    runModelTurn: h.runModelTurn,
    env: {},
  });
  assert.equal(d.type, "memory_command");
  assert.ok(h.has(EVENTS.MEMORY_STATE), "emits the real memory truth state");
  assert.equal(
    h.turns.length,
    0,
    "no model turn — no false 'I can't remember'"
  );
}

// 4) digit input matches a PendingAction FIRST (§6.4 — system-owned, not model-guessed)
{
  const h = harness();
  const d = await routeTurn("1", {
    emit: h.emit,
    runModelTurn: h.runModelTurn,
    pendingActions: [
      { key: "1", label: "生成 ROI 示例", payload: "生成 ROI 示例报告" },
    ],
  });
  assert.ok(d.matchedPendingAction, "digit matched a PendingAction");
  assert.equal(h.turns.length, 1, "runs the matched action's payload");
  assert.equal(h.turns[0], "生成 ROI 示例报告");
}

// 5) out_of_scope → decline, no model turn
{
  const h = harness();
  const d = await routeTurn("帮我写一首情诗", {
    emit: h.emit,
    runModelTurn: h.runModelTurn,
    role: "落地顾问",
  });
  assert.equal(d.type, "out_of_scope");
  assert.equal(
    h.turns.length,
    0,
    "out-of-scope doesn't burn the employee on it"
  );
  assert.ok(
    h.events.some(
      e => e.type === EVENTS.TOKEN_DELTA && /岗位/.test(e.data.text)
    ),
    "declines with a scope note"
  );
}

// 6) employee_task WITH taskRunId + a real deliverable → writes a REAL artifact file on disk
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewroute-"));
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const answer =
    "# 内部知识问答 ROI 报告\n\n## 假设\n- 团队 50 人\n\n## 结论\n年化节省约 30 万元。\n".repeat(
      3
    );
  const d = await routeTurn("给我一份内部知识问答 ROI 报告", {
    emit,
    runModelTurn: async () => answer,
    taskRunId: "test-task",
    root,
  });
  assert.equal(d.type, "employee_task");
  const art = events.find(e => e.type === EVENTS.ARTIFACT_CREATED);
  assert.ok(art, "a formal task emits artifact.created");
  assert.equal(
    art.data.taskRunId,
    "test-task",
    "artifact is correlated to its TaskRun"
  );
  assert.ok(
    art.data.path && fs.existsSync(art.data.path),
    "the artifact is a REAL file on disk (No-Artifact-No-Created)"
  );
  assert.ok(
    assertCreated({ path: art.data.path, bytes: art.data.bytes }),
    "assertCreated verifies the bytes match"
  );
  const revealHint = events.find(e => e.type === EVENTS.WORKSPACE_REVEALED);
  assert.equal(
    revealHint?.data?.ok,
    false,
    "artifact creation must not falsely claim the OS location was opened"
  );
  assert.equal(
    typeof revealHint?.data?.available,
    "boolean",
    "reveal capability is reported honestly"
  );
  assert.ok(
    events.some(
      e =>
        e.type === EVENTS.OUTCOME_CHECKED &&
        e.data.valid === true &&
        e.data.id === "test-task"
    ),
    "emits a correlated passing completion verdict (可验收)"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// 7) employee_task WITH taskRunId but a chat-only answer → No-Chat-only-Done flag, no file
{
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const d = await routeTurn("给我一份内部知识问答 ROI 报告", {
    emit,
    runModelTurn: async () => "好的。",
    taskRunId: "test-task-2",
    root: os.tmpdir(),
  });
  assert.equal(d.type, "employee_task");
  assert.ok(
    !events.some(e => e.type === EVENTS.ARTIFACT_CREATED),
    "no file written for a chat-only answer"
  );
  assert.ok(
    events.some(
      e => e.type === EVENTS.TOKEN_DELTA && /无交付物不算完成/.test(e.data.text)
    ),
    "honestly flags No-Chat-only-Done instead of implying 完成"
  );
  assert.ok(
    events.some(
      e => e.type === EVENTS.OUTCOME_CHECKED && e.data.valid === false
    ),
    "emits a failing completion verdict"
  );
}

// 8) explicit short-form request → a short answer does NOT trip No-Chat-only-Done (not pedantic)
{
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const d = await routeTurn("用一句话给我 AI 客服 ROI 要点", {
    emit,
    runModelTurn: async () =>
      "ROI≈自动解决率×单均人工成本,正向与否取决于解决率能否稳定到 30%+。",
    taskRunId: "test-short",
    root: os.tmpdir(),
  });
  assert.equal(d.type, "employee_task");
  assert.ok(
    !events.some(e => e.type === EVENTS.OUTCOME_CHECKED),
    "short-form ask: no pedantic verdict"
  );
  assert.ok(
    !events.some(
      e => e.type === EVENTS.TOKEN_DELTA && /无交付物不算完成/.test(e.data.text)
    ),
    "no No-Chat-only-Done nag for an explicitly-short answer"
  );
}

// 9) artifact review actions (AC-009/001/002): a deliverable emits accept/revise/reveal
//    PendingActions; typing "1" ACCEPTS it (marks artifact accepted + records valid) — not a guess.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewacc-"));
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const answer = "# 服务器清理报告\n\n## 结论\n年化节省约 30 万元。\n".repeat(
    8
  );
  await routeTurn("给我一份服务器清理报告", {
    emit,
    runModelTurn: async () => answer,
    taskRunId: "acc-task",
    root,
  });
  const pa = events.find(e => e.type === EVENTS.PENDING_ACTIONS);
  assert.ok(pa, "a deliverable emits review PendingActions");
  const accept = pa.data.actions.find(a => a.action_type === "accept");
  assert.ok(
    accept && accept.key === "1",
    "[1] is accept, carrying the artifact id"
  );
  assert.equal(accept.taskRunId, "acc-task");
  assert.match(
    accept.sha256,
    /^[a-f0-9]{64}$/,
    "review action binds the offered bytes by sha256"
  );

  const ev2 = [];
  const emit2 = (type, data) => ev2.push({ type, data });
  let modelRan = false;
  const d = await routeTurn("1", {
    emit: emit2,
    runModelTurn: async () => {
      modelRan = true;
    },
    pendingActions: pa.data.actions,
    root,
  });
  assert.ok(
    d.matchedPendingAction,
    "1 matched the accept action (not model-guessed)"
  );
  assert.equal(modelRan, false, "accept does NOT run a model turn");
  assert.ok(
    ev2.some(
      e =>
        e.type === EVENTS.ARTIFACT_UPDATED && e.data.patch.status === "accepted"
    ),
    "artifact marked accepted"
  );
  assert.ok(
    ev2.some(e => e.type === EVENTS.OUTCOME_CHECKED && e.data.valid === true),
    "task recorded valid/effective"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// Legacy/non-bridge acceptance is still a filesystem boundary: even a fully matching fingerprint
// captured from an external or multi-link file cannot bless it as a workspace artifact.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewacc-boundary-"));
  const artifactDir = path.join(root, ".crewclaw", "artifacts", "legacy-task");
  fs.mkdirSync(artifactDir, { recursive: true });
  const outsidePath = path.join(root, "outside.md");
  fs.writeFileSync(outsidePath, "# matching external bytes\n");
  const hardlinkPath = path.join(artifactDir, "hardlink.md");
  fs.linkSync(outsidePath, hardlinkPath);

  for (const [label, artifactPath] of [
    ["outside", outsidePath],
    ["hardlink", hardlinkPath],
  ]) {
    const fingerprint = captureArtifactFingerprint(artifactPath);
    assert.equal(fingerprint.ok, true);
    const events = [];
    const decision = await routeTurn("1", {
      root,
      emit: (type, data) => events.push({ type, data }),
      pendingActions: [
        {
          key: "1",
          label: "接受交付物",
          action_type: "accept",
          artifactId: `legacy-${label}`,
          taskRunId: "legacy-task",
          ...fingerprint,
        },
      ],
    });
    assert.equal(decision.blocked, true);
    assert.equal(
      events.some(
        event =>
          event.type === EVENTS.ARTIFACT_UPDATED &&
          event.data.patch.status === "accepted"
      ),
      false
    );
    assert.equal(
      events.some(
        event =>
          event.type === EVENTS.OUTCOME_CHECKED && event.data.valid === false
      ),
      true
    );
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// 10) AC-001: a report carrying a Markdown table also yields a real .csv spreadsheet Artifact
{
  const csv = markdownTableToCsv(
    "intro\n\n| 项目 | 值 |\n| --- | --- |\n| 工单量 | 1000 |\n\nmore"
  );
  assert.ok(
    csv && /项目,值/.test(csv) && /工单量,1000/.test(csv),
    "markdownTableToCsv extracts header + rows"
  );
  assert.equal(
    markdownTableToCsv("no table here, just prose"),
    null,
    "no table → null"
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewcsv-"));
  const events = [];
  const emit = (type, data) => events.push({ type, data });
  const answer =
    "# ROI 报告\n\n## 假设\n\n| 项目 | 值 |\n| --- | --- |\n| 月工单量 | 5000 |\n| 单均成本 | 8 元 |\n\n## 结论\n年化可观。\n";
  await routeTurn("给我一份带假设表的 ROI 报告", {
    emit,
    runModelTurn: async () => answer,
    taskRunId: "csv-task",
    root,
  });
  const arts = events.filter(e => e.type === EVENTS.ARTIFACT_CREATED);
  assert.equal(
    arts.length,
    2,
    "a report with a table writes TWO artifacts (.md + .csv)"
  );
  const csvArt = arts.find(e => /\.csv$/.test(e.data.name));
  assert.ok(
    csvArt && fs.existsSync(csvArt.data.path),
    "the .csv is a real file on disk"
  );
  assert.ok(
    /月工单量,5000/.test(fs.readFileSync(csvArt.data.path, "utf8")),
    "the .csv carries the table data"
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// 11) A plain "open folder" request is a structured workspace utility: no model, no fabricated
// deliverable/approval, and the OS action result is explicit.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewreveal-"));
  const events = [];
  let modelRan = false;
  const decision = await routeTurn("打开文件夹", {
    emit: (type, data) => events.push({ type, data }),
    runModelTurn: async () => {
      modelRan = true;
    },
    executeReveal: () => ({ ok: true }),
    taskRunId: "reveal-task",
    root,
  });
  assert.equal(modelRan, false, "workspace reveal does not call the model");
  assert.equal(
    decision.unscored,
    true,
    "workspace reveal is an un-scored utility"
  );
  assert.equal(
    events.some(event => event.type === EVENTS.ARTIFACT_CREATED),
    false
  );
  const revealed = events.find(
    event => event.type === EVENTS.WORKSPACE_REVEALED
  );
  assert.equal(revealed.data.id, "reveal-task");
  assert.equal(revealed.data.ok, true);
  assert.equal(revealed.data.available, true);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("tui-route tests passed");
