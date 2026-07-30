import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import {
  agentLoop,
  callModel,
  requiredToolPreflight,
  runStructuredProcess,
  runTool,
} from "../run.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";
import { initialAppState, reduce } from "../tui/app-state.mjs";
import { EVENTS, makeEvent } from "../tui/protocol.mjs";
import { startMockModel } from "./mock-model.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function waitFor(predicate, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await pause(10);
  }
  assert.fail(message);
}

async function withSseServer(writeResponse, run) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "close",
      });
      writeResponse(res);
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}/v1`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const modelOptions = baseUrl => ({
  baseUrl,
  apiKey: "test",
  model: "mock",
  temperature: 0,
  system: "test",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
});

test("callModel flushes a final SSE buffer and stops at [DONE]", async () => {
  await withSseServer(
    res => {
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: "尾帧" } }] })}`;
      res.end(frame); // deliberately no newline and no [DONE]
    },
    async baseUrl => {
      const deltas = [];
      const result = await callModel({
        ...modelOptions(baseUrl),
        onDelta: delta => deltas.push(delta),
      });
      assert.equal(result.content, "尾帧");
      assert.deepEqual(deltas, ["尾帧"]);
    }
  );

  await withSseServer(
    res => {
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "完成" } }] })}\n\n` +
          "data: [DONE]\n\n" +
          "data: {this must never be parsed}\n\n"
      );
    },
    async baseUrl => {
      const result = await callModel(modelOptions(baseUrl));
      assert.equal(result.content, "完成");
    }
  );
});

test("callModel rejects malformed data frames and empty generations", async () => {
  await withSseServer(
    res => res.end("data: {bad json}\n\n"),
    async baseUrl => {
      await assert.rejects(
        callModel(modelOptions(baseUrl)),
        /invalid SSE data frame.*bad json/
      );
    }
  );
  await withSseServer(
    res => res.end("data: [DONE]\n\n"),
    async baseUrl => {
      await assert.rejects(
        callModel(modelOptions(baseUrl)),
        /empty response without tool calls/
      );
    }
  );
});

test("callModel aborts an in-flight SSE response from the caller signal", async () => {
  await withSseServer(
    res => res.write(": keep-alive\n\n"),
    async baseUrl => {
      const controller = new AbortController();
      const pending = callModel({
        ...modelOptions(baseUrl),
        signal: controller.signal,
      });
      setTimeout(() => controller.abort("user_exit"), 20);
      await assert.rejects(
        pending,
        error => error?.code === "CREW_GENERATION_CANCELLED"
      );
    }
  );
});

test("callModel renews its idle watchdog on chunks and keeps a separate total cap", async () => {
  await withSseServer(
    res => {
      const frames = ["长", "任务", "完成"];
      let index = 0;
      // Send the first frame immediately so this test measures idle-window renewal,
      // not Windows loopback connection scheduling against a 40 ms deadline.
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: frames[index++] } }] })}\n\n`
      );
      const timer = setInterval(() => {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: frames[index++] } }] })}\n\n`
        );
        if (index === frames.length) {
          clearInterval(timer);
          res.end("data: [DONE]\n\n");
        }
      }, 30);
      res.on("close", () => clearInterval(timer));
    },
    async baseUrl => {
      const result = await callModel({
        ...modelOptions(baseUrl),
        idleTimeoutMs: 120,
        totalTimeoutMs: 500,
      });
      assert.equal(result.content, "长任务完成");
    }
  );

  await withSseServer(
    res => {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "开始" } }] })}\n\n`
      );
      setTimeout(() => res.end("data: [DONE]\n\n"), 250);
    },
    async baseUrl => {
      await assert.rejects(
        callModel({
          ...modelOptions(baseUrl),
          idleTimeoutMs: 100,
          totalTimeoutMs: 500,
        }),
        /stream was idle.*retry/
      );
    }
  );

  await withSseServer(
    res => {
      const timer = setInterval(
        () =>
          res.write(
            `data: ${JSON.stringify({ choices: [{ delta: { content: "." } }] })}\n\n`
          ),
        30
      );
      setTimeout(() => {
        clearInterval(timer);
        res.end("data: [DONE]\n\n");
      }, 350);
      res.on("close", () => clearInterval(timer));
    },
    async baseUrl => {
      await assert.rejects(
        callModel({
          ...modelOptions(baseUrl),
          idleTimeoutMs: 120,
          totalTimeoutMs: 150,
        }),
        /generation exceeded.*HERMES_TOTAL_TIMEOUT_MS/
      );
    }
  );
});

test("artifact preflight blocks an explicit file task before spending model tokens", () => {
  const blocked = requiredToolPreflight(
    { blocking: [], degraded: [], visibleTools: [] },
    { taskText: "给我一份方案 输出为 plan.pdf" }
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "tool_preflight_blocked");
  assert.match(blocked.reason, /plan\.pdf/);
  assert.match(blocked.reason, /文档生成能力建设中/);

  const ordinary = requiredToolPreflight(
    { blocking: [], degraded: [], visibleTools: [] },
    { taskText: "解释这段方案" }
  );
  assert.equal(ordinary.ok, true);
});

test("runTool rejects an already-cancelled signal before doing work", async () => {
  const controller = new AbortController();
  controller.abort("user_exit");
  await assert.rejects(
    runTool(
      "read_file",
      { path: "must-not-be-read" },
      {
        root: process.cwd(),
        signal: controller.signal,
        permission: {
          decision: "allow",
          level: "L0",
          scope: "test",
          reason: "test",
        },
      }
    ),
    error => error?.code === "CREW_GENERATION_CANCELLED"
  );
});

test("agentLoop emits a stable live tool lifecycle and keeps its audit record", async () => {
  const model = await startMockModel([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "call-stable",
            function: { name: "noop", arguments: '{"value":1}' },
          },
        ],
      },
    ],
    [{ content: "完成" }],
  ]);
  const messages = [{ role: "user", content: "run" }];
  const lifecycle = [];
  const audits = [];
  try {
    const output = await agentLoop({
      baseUrl: model.url,
      apiKey: "test",
      model: "mock",
      temperature: 0,
      system: "",
      messages,
      name: "测试员工",
      isTTY: false,
      renderMd: false,
      tools: [
        {
          type: "function",
          function: {
            name: "noop",
            description: "test",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      gateway: {
        check() {
          return {
            decision: "allow",
            level: "L0",
            scope: "test",
            reason: "test",
          };
        },
      },
      onDelta() {},
      onToolEvent: event => lifecycle.push(event),
      onInvocation: record => audits.push(record),
    });
    assert.equal(output, "完成");
    assert.deepEqual(
      lifecycle.map(event => event.phase),
      ["requested", "running", "succeeded"]
    );
    assert.equal(new Set(lifecycle.map(event => event.id)).size, 1);
    assert.equal(lifecycle[0].id, "call-stable");
    assert.deepEqual(lifecycle[0].args, { value: 1 });
    assert.equal(lifecycle[0].name, "noop");
    assert.equal(lifecycle[0].args_summary, '{"value":1}');
    assert.equal(lifecycle[0].label, 'noop · {"value":1}');
    assert.equal(lifecycle[0].result_summary, undefined);
    assert.equal(lifecycle[2].result_summary, "已完成");
    assert.equal(lifecycle[2].summary, "已完成");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].call_id, "call-stable");
    assert.equal(audits[0].name, "noop");
    assert.equal(audits[0].args_summary, '{"value":1}');
    assert.equal(audits[0].result_summary, "已完成");
    assert.equal(
      messages.find(message => message.role === "tool")?.tool_call_id,
      "call-stable"
    );
  } finally {
    await model.close();
  }
});

test("agentLoop enforces employee max_calls_per_task and resets it for a new turn", async () => {
  const tool = {
    type: "function",
    function: {
      name: "noop",
      description: "bounded test tool",
      parameters: { type: "object", properties: {} },
    },
  };
  const gateway = {
    check() {
      return {
        decision: "allow",
        level: "L0",
        scope: "test",
        reason: "test",
        decision_source: "employee_policy",
        capability: "test.noop",
        limits: { max_calls_per_task: 3 },
      };
    },
  };

  async function runBoundedTurn(callCount) {
    let step = 0;
    const events = [];
    const audits = [];
    const output = await agentLoop({
      baseUrl: "http://mock.invalid",
      apiKey: "test",
      model: "mock",
      temperature: 0,
      system: "",
      messages: [{ role: "user", content: "run" }],
      name: "测试员工",
      isTTY: false,
      renderMd: false,
      tools: [tool],
      gateway,
      onDelta() {},
      onToolEvent: event => events.push(event),
      onInvocation: record => audits.push(record),
      callModelFn: async () => {
        if (step < callCount) {
          const id = `bounded-${++step}`;
          return {
            content: "",
            usage: null,
            toolCalls: [
              {
                id,
                type: "function",
                function: { name: "noop", arguments: "{}" },
              },
            ],
          };
        }
        return { content: "done", usage: null, toolCalls: [] };
      },
    });
    return { output, events, audits };
  }

  const first = await runBoundedTurn(4);
  assert.equal(first.output, "done");
  assert.deepEqual(
    first.events
      .filter(event => event.id === "bounded-4")
      .map(event => event.phase),
    ["requested", "blocked"]
  );
  assert.equal(first.audits[3].status, "blocked");
  assert.equal(first.audits[3].decision_source, "employee_limit");
  assert.match(first.audits[3].error_message, /^$/);

  const second = await runBoundedTurn(1);
  assert.deepEqual(
    second.events
      .filter(event => event.id === "bounded-1")
      .map(event => event.phase),
    ["requested", "running", "succeeded"],
    "a fresh agentLoop gets a fresh per-turn counter"
  );
});

test("agentLoop turns an employee tool timeout into a recoverable failed lifecycle", async () => {
  const events = [];
  let modelStep = 0;
  const output = await agentLoop({
    baseUrl: "http://mock.invalid",
    apiKey: "test",
    model: "mock",
    temperature: 0,
    system: "",
    messages: [{ role: "user", content: "run" }],
    name: "超时测试员工",
    isTTY: false,
    renderMd: false,
    tools: [
      {
        type: "function",
        function: {
          name: "slow_tool",
          description: "slow test tool",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    gateway: {
      check() {
        return {
          decision: "allow",
          level: "L0",
          scope: "test",
          reason: "test timeout",
          decision_source: "employee_policy",
          capability: "test.slow",
          limits: { timeout_ms: 25 },
        };
      },
    },
    onDelta() {},
    onToolEvent: event => events.push(event),
    callModelFn: async () => {
      if (modelStep++ === 0) {
        return {
          content: "",
          usage: null,
          toolCalls: [
            {
              id: "timeout-call",
              type: "function",
              function: { name: "slow_tool", arguments: "{}" },
            },
          ],
        };
      }
      return { content: "model recovered", usage: null, toolCalls: [] };
    },
    runToolFn: async (_name, _args, { signal }) =>
      await new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason || new Error("tool aborted")),
          { once: true }
        );
      }),
  });
  assert.equal(output, "model recovered");
  const lifecycle = events
    .filter(event => event.id === "timeout-call")
    .map(event => event.phase);
  assert.deepEqual(lifecycle, ["requested", "running", "failed"]);
  assert.equal(
    events.find(
      event => event.id === "timeout-call" && event.phase === "failed"
    )?.code,
    "tool_timeout"
  );
});

function bridgeHarness(agentLoopImpl) {
  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) events.push(JSON.parse(line));
      }
      callback();
    },
  });
  const root = mkdtempSync(join(tmpdir(), "crew-stream-lifecycle-"));
  const done = startJsonlBridge({
    agentLoop: agentLoopImpl,
    meta: { mode: "Chat", agentId: "stream-test-agent" },
    input,
    output,
    root,
  });
  return { input, events, root, done };
}

async function closeBridge(harness) {
  harness.input.push("/exit\n");
  await harness.done;
  rmSync(harness.root, { recursive: true, force: true });
}

test("JSONL bridge freezes assistant parts around one live tool row", async () => {
  const harness = bridgeHarness(async options => {
    options.onDelta("## 计划\n先检索。\n");
    const base = {
      id: "call-1",
      toolName: "web_search",
      name: "web_search",
      args: { query: "CrewClaw" },
      args_summary: '"CrewClaw"',
      label: 'web_search · "CrewClaw"',
    };
    options.onToolEvent({
      ...base,
      phase: "requested",
      action: "搜索 CrewClaw",
    });
    options.onToolEvent({ ...base, phase: "running" });
    options.onToolEvent({
      ...base,
      phase: "succeeded",
      result_summary: "3 条",
      summary: "找到 3 个来源",
      detail: "result",
    });
    options.onInvocation({
      call_id: "call-1",
      toolName: "web_search",
      args: base.args,
      status: "success",
      action: "找到 3 个来源",
    });
    options.onDelta("## 结论\n已验证。\n");
    return "已验证";
  });
  harness.input.push("请介绍你的能力\n");
  await waitFor(
    () => harness.events.some(event => event.type === "task.completed"),
    "turn did not complete"
  );

  const rendered = harness.events.filter(
    event => event.type === "assistant.rendered"
  );
  assert.equal(rendered.length, 2);
  assert.notEqual(rendered[0].data.part_id, rendered[1].data.part_id);
  assert.match(rendered[0].data.text, /计划/);
  assert.doesNotMatch(rendered[0].data.text, /结论/);
  assert.match(rendered[1].data.text, /结论/);
  assert.deepEqual(
    harness.events
      .filter(event => event.type.startsWith("tool."))
      .map(event => event.type),
    ["tool.requested", "tool.running", "tool.succeeded"]
  );
  const correlated = harness.events.filter(event =>
    /^(?:task\.started|generation\.|token\.delta|assistant\.rendered|tool\.|task\.completed)$/.test(
      event.type
    )
  );
  const taskRunId = correlated[0].data.taskRunId;
  const turnId = correlated[0].data.turn_id;
  assert.ok(correlated.every(event => event.data.taskRunId === taskRunId));
  assert.ok(correlated.every(event => event.data.turn_id === turnId));
  const seqs = correlated.map(event => event.data.seq);
  assert.deepEqual(
    seqs,
    [...seqs].sort((a, b) => a - b)
  );
  assert.equal(new Set(seqs).size, seqs.length);
  const toolEvents = harness.events.filter(event =>
    event.type.startsWith("tool.")
  );
  assert.ok(toolEvents.every(event => event.data.name === "web_search"));
  assert.ok(
    toolEvents.every(event => event.data.args_summary === '"CrewClaw"')
  );
  assert.ok(
    toolEvents.every(event => event.data.label === 'web_search · "CrewClaw"')
  );
  assert.equal(toolEvents.at(-1).data.result_summary, "3 条");
  assert.equal(toolEvents.at(-1).data.summary, "3 条");
  await closeBridge(harness);
});

test("JSONL bridge queues busy input and runs it after the active turn", async () => {
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const harness = bridgeHarness(async options => {
    calls += 1;
    options.onDelta(`回答-${calls}`);
    if (calls === 1) await firstGate;
    return `回答-${calls}`;
  });
  harness.input.push("请介绍你的能力\n");
  await waitFor(
    () => harness.events.some(event => event.type === "token.delta"),
    "first turn did not start"
  );
  harness.input.push("再补充一句\n");
  const queued = await waitFor(
    () => harness.events.find(event => event.type === "input.queued"),
    "busy input was not queued"
  );
  assert.equal(queued.data.position, 1);
  releaseFirst();
  await waitFor(
    () =>
      harness.events.filter(event => event.type === "task.completed").length ===
      2,
    "queued input was not executed"
  );
  assert.equal(calls, 2);
  assert.equal(
    harness.events.filter(event => event.type === "task.started")[1].data
      .queued,
    true
  );
  await closeBridge(harness);
});

test("closing the bridge cancels generation and drops late deltas", async () => {
  const harness = bridgeHarness(async options => {
    options.onDelta("早到内容");
    await new Promise(resolve =>
      options.signal.addEventListener("abort", resolve, { once: true })
    );
    options.onDelta("绝不能出现的晚到内容");
    const error = new Error("cancelled");
    error.code = "CREW_GENERATION_CANCELLED";
    throw error;
  });
  harness.input.push("请介绍你的能力\n");
  await waitFor(
    () => harness.events.some(event => event.type === "token.delta"),
    "generation did not start"
  );
  harness.input.push("/exit\n");
  await harness.done;
  await pause(30);

  const types = harness.events.map(event => event.type);
  const cancelled = types.lastIndexOf("generation.cancelled");
  const blocked = types.lastIndexOf("task.blocked");
  assert.ok(cancelled >= 0 && blocked > cancelled);
  assert.ok(
    !harness.events.some(
      event =>
        event.type === "token.delta" && /晚到内容/.test(event.data.text || "")
    )
  );
  assert.equal(types.includes("task.completed"), false);
  rmSync(harness.root, { recursive: true, force: true });
});

test("generation.cancel aborts the active turn without closing the bridge", async () => {
  const harness = bridgeHarness(async options => {
    options.onDelta("正在生成");
    await new Promise(resolve =>
      options.signal.addEventListener("abort", resolve, { once: true })
    );
    const error = new Error("cancelled");
    error.code = "CREW_GENERATION_CANCELLED";
    throw error;
  });
  harness.input.push("开始一个长任务\n");
  await waitFor(
    () => harness.events.some(event => event.type === "token.delta"),
    "generation did not start"
  );
  harness.input.push(
    `${JSON.stringify({ type: "generation.cancel", data: {} })}\n`
  );
  await waitFor(
    () => harness.events.some(event => event.type === "task.blocked"),
    "cancel action did not block the active task"
  );
  const types = harness.events.map(event => event.type);
  assert.ok(types.indexOf("generation.cancelled") >= 0);
  assert.ok(
    types.indexOf("task.blocked") > types.indexOf("generation.cancelled")
  );
  assert.equal(types.includes("task.completed"), false);
  assert.equal(types.includes("task.rejected"), false);
  await closeBridge(harness);
});

test("closing the bridge cancels a real running tool process exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "crew-stream-tool-cancel-"));
  const startedPath = join(root, "started.flag");
  const latePath = join(root, "late.flag");
  writeFileSync(
    join(root, "hold.cjs"),
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync("started.flag", "started");',
      'setTimeout(() => fs.writeFileSync("late.flag", "late"), 1200);',
      "setInterval(() => {}, 1000);",
    ].join("\n")
  );

  const model = await startMockModel([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "call-cancel-real",
            function: {
              name: "test_process",
              arguments: "{}",
            },
          },
        ],
      },
    ],
    [{ content: "绝不能完成" }],
  ]);
  const input = new Readable({ read() {} });
  const events = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split("\n")) {
        if (line.trim()) events.push(JSON.parse(line));
      }
      callback();
    },
  });
  const done = startJsonlBridge({
    agentLoop,
    agentLoopDeps: {
      baseUrl: model.url,
      apiKey: "test",
      model: "mock",
      temperature: 0,
      system: "",
      name: "测试员工",
      isTTY: false,
      root,
      runToolFn: (_name, _args, { signal }) =>
        runStructuredProcess(process.execPath, [join(root, "hold.cjs")], {
          cwd: root,
          timeoutMs: 30_000,
          signal,
        }),
      tools: [
        {
          type: "function",
          function: {
            name: "test_process",
            description: "run a bounded test process",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      gateway: {
        check() {
          return {
            decision: "allow",
            level: "L0",
            scope: "test_process",
            reason: "test",
            decision_source: "test",
          };
        },
      },
    },
    meta: { mode: "Chat", agentId: "stream-tool-cancel" },
    input,
    output,
    root,
  });
  let closed = false;
  try {
    input.push("请运行这个测试进程\n");
    await waitFor(
      () =>
        events.some(
          event =>
            event.type === "tool.running" &&
            event.data.id === "call-cancel-real"
        ),
      "real tool never entered running",
      6_000
    );
    await waitFor(
      () => existsSync(startedPath),
      "test_run child process never started",
      6_000
    );

    input.push("/exit\n");
    await done;
    closed = true;
    await pause(1_600);

    const lifecycle = events
      .filter(event => event.data?.id === "call-cancel-real")
      .map(event => event.type);
    assert.deepEqual(lifecycle, [
      "tool.requested",
      "tool.running",
      "tool.cancelled",
    ]);
    const reduced = events.reduce(reduce, initialAppState());
    assert.equal(reduced.tools["call-cancel-real"].status, "cancelled");
    assert.equal(
      reduced.timeline.filter(line => line.id === "call-cancel-real").length,
      1,
      "the UI reducer keeps one tool row and closes its running state"
    );
    const types = events.map(event => event.type);
    const toolCancelled = types.indexOf("tool.cancelled");
    const generationCancelled = types.indexOf("generation.cancelled");
    const taskBlocked = types.indexOf("task.blocked");
    assert.ok(
      toolCancelled >= 0 &&
        generationCancelled > toolCancelled &&
        taskBlocked > generationCancelled,
      `unexpected terminal order: ${types.join(",")}`
    );
    assert.equal(
      existsSync(latePath),
      false,
      "the cancelled process tree must not survive to write its late marker"
    );
    assert.equal(types.includes("task.completed"), false);
  } finally {
    if (!closed) {
      input.push("/exit\n");
      await done.catch(() => {});
    }
    await model.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "opt-in: test_run cancellation kills the npm/cmd/grandchild process tree",
  { skip: process.env.CREW_PROCESS_TREE_E2E !== "1" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "crew-stream-tree-e2e-"));
    const startedPath = join(root, "tree-started.flag");
    const latePath = join(root, "tree-late.flag");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.0.0",
        scripts: { "test:hold": "node hold-tree.cjs" },
      })
    );
    writeFileSync(
      join(root, "hold-tree.cjs"),
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync("tree-started.flag", JSON.stringify({pid:process.pid,ppid:process.ppid}));',
        'setTimeout(() => fs.writeFileSync("tree-late.flag", "late"), 2000);',
        "setTimeout(() => process.exit(0), 3000);",
      ].join("\n")
    );
    const model = await startMockModel([
      [
        {
          tool_calls: [
            {
              index: 0,
              id: "call-cancel-tree",
              function: {
                name: "test_run",
                arguments: '{"script":"test:hold"}',
              },
            },
          ],
        },
      ],
      [{ content: "绝不能完成" }],
    ]);
    const input = new Readable({ read() {} });
    const events = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        for (const line of String(chunk).split("\n")) {
          if (line.trim()) events.push(JSON.parse(line));
        }
        callback();
      },
    });
    const done = startJsonlBridge({
      agentLoop,
      agentLoopDeps: {
        baseUrl: model.url,
        apiKey: "test",
        model: "mock",
        temperature: 0,
        system: "",
        name: "测试员工",
        isTTY: false,
        root,
        tools: [
          {
            type: "function",
            function: {
              name: "test_run",
              description: "run a declared test script",
              parameters: {
                type: "object",
                properties: { script: { type: "string" } },
                required: ["script"],
                additionalProperties: false,
              },
            },
          },
        ],
        gateway: {
          check() {
            return {
              decision: "allow",
              level: "L0",
              scope: "test:hold",
              reason: "process-tree e2e",
              decision_source: "test",
            };
          },
        },
      },
      meta: { mode: "Chat", agentId: "stream-tree-cancel" },
      input,
      output,
      root,
    });
    let closed = false;
    try {
      input.push("请运行这个已声明的测试脚本\n");
      await waitFor(
        () => existsSync(startedPath),
        "npm test_run grandchild never started",
        8_000
      );
      const started = JSON.parse(readFileSync(startedPath, "utf8"));
      assert.ok(
        Number.isSafeInteger(started.pid),
        "started marker includes hold PID"
      );
      input.push("/exit\n");
      await done;
      closed = true;
      await pause(2_300);
      assert.deepEqual(
        events
          .filter(event => event.data?.id === "call-cancel-tree")
          .map(event => event.type),
        ["tool.requested", "tool.running", "tool.cancelled"]
      );
      assert.equal(
        existsSync(latePath),
        false,
        "the real npm/cmd/grandchild tree survived cancellation"
      );
      await waitFor(
        () => !processIsAlive(started.pid),
        "the npm/cmd/node grandchild PID survived cancellation",
        3_000
      );
    } finally {
      if (!closed) {
        input.push("/exit\n");
        await done.catch(() => {});
      }
      await model.close();
      await pause(900);
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }
);

test(
  "Windows bash cancellation kills the controlled process tree",
  { skip: process.platform !== "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "crew-bash-job-cancel-"));
    const startedPath = join(root, "tree-started.json");
    const latePath = join(root, "tree-late.flag");
    const controller = new AbortController();
    writeFileSync(
      join(root, "hold-tree.cjs"),
      [
        'const fs = require("node:fs");',
        'fs.writeFileSync("tree-started.json", JSON.stringify({pid:process.pid,ppid:process.ppid}));',
        'setTimeout(() => fs.writeFileSync("tree-late.flag", "late"), 1400);',
        "setInterval(() => {}, 1000);",
      ].join("\n")
    );
    try {
      const pending = runTool(
        "bash",
        { command: "node hold-tree.cjs" },
        {
          root,
          signal: controller.signal,
          permission: {
            decision: "allow",
            level: "L4",
            scope: "node hold-tree.cjs",
            reason: "Windows Job cancellation test",
          },
        }
      );
      await waitFor(
        () => existsSync(startedPath),
        "bash child did not start",
        10_000
      );
      const started = JSON.parse(readFileSync(startedPath, "utf8"));
      controller.abort("user_exit");
      await assert.rejects(
        pending,
        error => error?.code === "CREW_GENERATION_CANCELLED"
      );
      await pause(1_700);
      assert.equal(
        existsSync(latePath),
        false,
        "bash descendant survived cancellation"
      );
      await waitFor(
        () => !processIsAlive(started.pid),
        "bash descendant PID survived cancellation",
        3_000
      );
    } finally {
      controller.abort("test_cleanup");
      await pause(300);
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }
);

test(
  "Windows test_run and bash fail closed when the Job owner cannot initialize",
  { skip: process.platform !== "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "crew-job-owner-fail-"));
    const startedPath = join(root, "should-not-start.flag");
    const prior = process.env.CREW_FORCE_WINDOWS_JOB_SETUP_FAIL;
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.0.0",
        scripts: { "test:hold": "node should-not-start.cjs" },
      })
    );
    writeFileSync(
      join(root, "should-not-start.cjs"),
      'require("node:fs").writeFileSync("should-not-start.flag", "started");'
    );
    process.env.CREW_FORCE_WINDOWS_JOB_SETUP_FAIL = "1";
    try {
      await assert.rejects(
        runTool(
          "test_run",
          { script: "test:hold" },
          {
            root,
            permission: {
              decision: "allow",
              level: "L2",
              scope: "test:hold",
              reason: "Job owner fail-closed test",
            },
          }
        ),
        error =>
          error?.code === "windows_job_unavailable" &&
          /forced Windows Job setup failure/.test(error.message)
      );
      await assert.rejects(
        runTool(
          "bash",
          { command: "node should-not-start.cjs" },
          {
            root,
            permission: {
              decision: "allow",
              level: "L4",
              scope: "node should-not-start.cjs",
              reason: "bash Job owner fail-closed test",
            },
          }
        ),
        error =>
          error?.code === "windows_job_unavailable" &&
          /forced Windows Job setup failure/.test(error.message)
      );
      assert.equal(
        existsSync(startedPath),
        false,
        "a Job setup failure must not fall back to an uncontrolled npm command"
      );
    } finally {
      if (prior === undefined)
        delete process.env.CREW_FORCE_WINDOWS_JOB_SETUP_FAIL;
      else process.env.CREW_FORCE_WINDOWS_JOB_SETUP_FAIL = prior;
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test("reference reducer tracks generation/queue/tool states and rejects late events", () => {
  const events = [
    makeEvent(EVENTS.TASK_STARTED, {
      id: "task-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 1,
      mode: "Chat",
    }),
    makeEvent(EVENTS.GENERATION_STARTED, {
      id: "generation-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 2,
    }),
    makeEvent(EVENTS.INPUT_QUEUED, {
      id: "input-next",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 3,
      position: 1,
      text: "下一问",
    }),
    makeEvent(EVENTS.TOOL_REQUESTED, {
      id: "tool-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 4,
      tool: "web_search",
    }),
    makeEvent(EVENTS.TOOL_RUNNING, {
      id: "tool-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 5,
      tool: "web_search",
    }),
    makeEvent(EVENTS.TOOL_CANCELLED, {
      id: "tool-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 6,
      tool: "web_search",
    }),
    makeEvent(EVENTS.GENERATION_CANCELLED, {
      id: "generation-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 7,
      reason: "user exit",
    }),
    makeEvent(EVENTS.TASK_BLOCKED, {
      id: "task-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 8,
      reason: "user exit",
    }),
    makeEvent(EVENTS.TOKEN_DELTA, {
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 9,
      text: "late",
    }),
    makeEvent(EVENTS.TOOL_SUCCEEDED, {
      id: "tool-live",
      taskRunId: "task-live",
      turn_id: "turn-live",
      seq: 10,
      tool: "web_search",
    }),
  ];
  const state = events.reduce(reduce, initialAppState());
  assert.equal(state.generation.status, "cancelled");
  assert.equal(state.queuedInputs[0].text, "下一问");
  assert.equal(state.tools["tool-live"].status, "cancelled");
  assert.equal(state.task.status, "blocked");
  assert.equal(state.answer, "");
  assert.ok(
    state.debug.some(line => line.includes("token.delta after terminal"))
  );
  assert.ok(
    state.debug.some(line => line.includes("tool.succeeded after terminal"))
  );
});
