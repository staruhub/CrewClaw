// tui/workbench-demo.mjs — renders a TaskRun (NOT a message stream) from the AppState the
// event-bridge folds: work timeline (✓/✗/→/!/?) + tools + evidence/artifact + the answer.
// The "渲染 TaskRun，不渲染 Message" iron law, on screen.
//   FORCE_COLOR=1 node tui/workbench-demo.mjs
import React from "react";
import { render, Box } from "ink";
import htm from "htm";
import { createTaskRun } from "./event-bridge.mjs";
import { EVENTS } from "./protocol.mjs";
import { UserMessage, TurnView, StatusHeader } from "./components.mjs";
import { getToolTruth } from "../tool-truth.mjs";
import { getMemoryTruth } from "../memory-harness.mjs";

const html = htm.bind(React.createElement);
const stub = t =>
  String(t)
    .split("\n")
    .map(l => "   " + l);
const TOOLS = getToolTruth();
const MEMORY = getMemoryTruth();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let done;
function Demo() {
  const [state, setState] = React.useState(null);
  React.useEffect(() => {
    const run = createTaskRun(
      { employee: { name: "鲸", role: "落地顾问" }, mode: "Trial" },
      setState
    );
    (async () => {
      run.start("调研火山 Seed 2.1", "Trial");
      await sleep(140);
      run.emit(EVENTS.PLAN_CREATED, {
        id: "p",
        steps: ["官方源优先", "抽字段", "组装报告"],
      });
      await sleep(140);
      run.sink.onInvocation({
        toolName: "web_search",
        action: "已跳过",
        line: '🔎 "Seed 2.1"',
        status: "blocked",
        code: "missing_key",
      });
      await sleep(140);
      run.sink.onInvocation({
        toolName: "web_fetch",
        action: "读取官方文档",
        line: "🌐 ark.volcengine (412 字)",
        status: "success",
      });
      await sleep(140);
      run.emit(EVENTS.EVIDENCE_CREATED, {
        id: "e1",
        fact: "上下文 256k",
        source: "official",
        confidence: 0.8,
      });
      await sleep(120);
      for (const ch of "根据官方文档，Seed 2.1 上下文 256k、定价 [需核实]，建议先小流量接入。") {
        run.sink.onDelta(ch);
        await sleep(7);
      }
      run.emit(EVENTS.ARTIFACT_CREATED, {
        id: "a1",
        name: "seed-2.1-research.md",
        type: "report",
        status: "draft",
        checks: ["≥2 来源"],
      });
      await sleep(120);
      run.sink.onUsage({ prompt_tokens: 1800, completion_tokens: 240 });
      run.complete();
      await sleep(160);
      done && done();
    })();
  }, []);
  if (!state) return html`<${Box} />`;
  const tokens = state.usage.promptTok + state.usage.completionTok;
  return html`
    <${Box} flexDirection="column">
      <${UserMessage} text="调研火山 Seed 2.1 是否适合接入" />
      <${TurnView} state=${state} name="鲸" renderLines=${stub} caret=${state.status !== "done"} />
      <${Box} marginTop=${1}>
        <${StatusHeader} name="鲸" role="落地顾问" mode=${state.mode} status=${state.status === "done" ? "idle" : "streaming"} tokens=${tokens} costText="$0.06" toolTruth=${TOOLS} memory=${MEMORY} />
      </>
    </>
  `;
}

const app = render(html`<${Demo} />`);
done = app.unmount;
await app.waitUntilExit();
console.log("[workbench-demo] TaskRun rendered & exited cleanly");
