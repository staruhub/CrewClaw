import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mammoth from "mammoth";

import { callMcpTool, mcpReadiness, parseMcpConfig } from "../mcp-client.mjs";
import { runtimeToolReadiness } from "../employee-tools.mjs";
import { loadMemoryCandidates } from "../memory-candidates.mjs";
import {
  agentLoop,
  employeeAgentLoopDeps,
  loadProfile,
  runTool,
} from "../run.mjs";

const allow = {
  decision: "allow",
  level: "L0",
  scope: "test",
  reason: "test",
};

test("todo_write requires one real approval and emits live status updates", async () => {
  const todoState = { proposed: false, approved: false, todos: [] };
  const updates = [];
  let approvals = 0;
  const proposed = await runTool(
    "todo_write",
    {
      todos: [
        { content: "读取输入", status: "pending" },
        { content: "生成文档", status: "pending" },
        { content: "验证产物", status: "pending" },
      ],
    },
    {
      permission: allow,
      todoState,
      onTodoUpdated: update => updates.push(update.phase),
      confirm: async () => {
        approvals += 1;
        return true;
      },
    }
  );
  assert.match(proposed, /"approved":true/);
  assert.deepEqual(updates, ["proposed", "approved"]);

  await runTool(
    "todo_write",
    {
      todos: [
        { content: "读取输入", status: "completed" },
        { content: "生成文档", status: "in_progress" },
        { content: "验证产物", status: "pending" },
      ],
    },
    {
      permission: allow,
      todoState,
      onTodoUpdated: update => updates.push(update.phase),
    }
  );
  assert.equal(approvals, 1);
  assert.equal(updates.at(-1), "updated");
});

test("a rejected plan fail-closes later tools until the plan is revised", async () => {
  let turn = 0;
  const events = [];
  const output = await agentLoop({
    baseUrl: "http://mock.invalid",
    apiKey: "test",
    model: "mock",
    temperature: 0,
    system: "",
    messages: [{ role: "user", content: "three steps" }],
    name: "Planner",
    isTTY: false,
    renderMd: false,
    tools: [
      {
        type: "function",
        function: {
          name: "todo_write",
          description: "plan",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "read_file",
          description: "read",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    gateway: { check: () => ({ ...allow }) },
    confirm: async () => false,
    onDelta() {},
    onToolEvent: event => events.push(event),
    callModelFn: async () => {
      turn += 1;
      if (turn === 1) {
        return {
          content: "",
          toolCalls: [
            {
              id: "plan",
              function: {
                name: "todo_write",
                arguments: JSON.stringify({
                  todos: [
                    { content: "一", status: "pending" },
                    { content: "二", status: "pending" },
                    { content: "三", status: "pending" },
                  ],
                }),
              },
            },
          ],
        };
      }
      if (turn === 2) {
        return {
          content: "",
          toolCalls: [
            {
              id: "must-block",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "does-not-exist" }),
              },
            },
          ],
        };
      }
      return { content: "等待计划修订", toolCalls: [] };
    },
  });
  assert.equal(output, "等待计划修订");
  assert.ok(
    events.some(
      event =>
        event.id === "must-block" &&
        event.phase === "blocked" &&
        event.decision?.decision_source === "plan_gate"
    )
  );
});

test("ask_user waits for structured input and note_memory only writes candidates", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-orchestration-"));
  try {
    const answer = await runTool(
      "ask_user",
      { question: "选哪个？", options: ["甲", "乙"] },
      { permission: allow, askUser: async question => question.options[1] }
    );
    assert.match(answer, /"answer":"乙"/);

    const recorded = [];
    const note = await runTool(
      "note_memory",
      {
        category: "project_facts",
        text: "项目使用 pnpm。",
        confidence: "high",
      },
      {
        root,
        employeeId: "whale",
        taskRunId: "task-1",
        permission: allow,
        onMemoryCandidate: candidate => recorded.push(candidate),
      }
    );
    assert.match(note, /"active_memory_changed":false/);
    assert.equal(recorded.length, 1);
    assert.equal(loadMemoryCandidates(root, "whale").records.length, 1);
    assert.equal(
      existsSync(join(root, ".crewclaw", "memory", "whale.json")),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("docx_write produces a managed Word file that mammoth can read", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-docx-"));
  try {
    let artifact;
    const result = await runTool(
      "docx_write",
      { name: "交付.docx", title: "项目周报", content: "第一段\n第二段" },
      {
        root,
        taskRunId: "task-docx",
        permission: allow,
        onArtifactCreated: value => {
          artifact = value;
        },
      }
    );
    assert.match(result, /"validated":true/);
    assert.ok(artifact?.path.endsWith("交付.docx"));
    const parsed = await mammoth.extractRawText({
      buffer: readFileSync(artifact.path),
    });
    assert.match(parsed.value, /项目周报/);
    assert.match(parsed.value, /第一段/);
    assert.match(parsed.value, /第二段/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP client discovers a live schema lazily, calls the tool, and writes an audit", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-mcp-"));
  const fixture = join(root, "fake-mcp.mjs");
  writeFileSync(
    fixture,
    `let buffer="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{buffer+=chunk;const lines=buffer.split(/\\r?\\n/);buffer=lines.pop()||"";for(const line of lines){if(!line.trim())continue;const m=JSON.parse(line);if(!Object.hasOwn(m,"id"))continue;let result={};if(m.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}};if(m.method==="tools/list")result={tools:[{name:"echo_read",description:"read",inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"]}}]};if(m.method==="tools/call")result={content:[{type:"text",text:"echo:"+m.params.arguments.value}]};process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n");}});`,
    "utf8"
  );
  try {
    const mcp = parseMcpConfig(
      {
        mcp_servers: {
          github: {
            command: process.execPath,
            args: [fixture],
            env: {},
            tools: { include: ["echo_read"] },
          },
        },
      },
      { env: {}, profileDir: root }
    );
    assert.deepEqual([...mcp.providers], ["mcp.github"]);
    assert.match(mcp.indexText, /github: echo_read/);
    const output = await callMcpTool(
      mcp,
      { server: "github", tool: "echo_read", arguments: { value: "ok" } },
      { root, employeeId: "shrimp", taskRunId: "task-mcp" }
    );
    assert.equal(output, "echo:ok");
    const logDir = join(root, ".crewclaw", "mcp", "shrimp");
    const logs = readdirSync(logDir);
    assert.equal(logs.length, 1);
    assert.equal(
      JSON.parse(readFileSync(join(logDir, logs[0]), "utf8")).status,
      "succeeded"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP intent persistence fail-closes before an external effect", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-mcp-intent-"));
  const fixture = join(root, "fake-mcp.mjs");
  const marker = join(root, "effect.log");
  writeFileSync(
    fixture,
    `import{appendFileSync}from"node:fs";let buffer="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{buffer+=chunk;const lines=buffer.split(/\\r?\\n/);buffer=lines.pop()||"";for(const line of lines){if(!line.trim())continue;const m=JSON.parse(line);if(!Object.hasOwn(m,"id"))continue;let result={};if(m.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}};if(m.method==="tools/list")result={tools:[{name:"mutate",inputSchema:{type:"object"}}]};if(m.method==="tools/call"){appendFileSync(process.argv[2],"effect\\n");result={content:[{type:"text",text:"done"}]};}process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n");}});`,
    "utf8"
  );
  mkdirSync(join(root, ".crewclaw"), { recursive: true });
  writeFileSync(join(root, ".crewclaw", "mcp"), "not a directory", "utf8");
  try {
    const mcp = parseMcpConfig(
      {
        mcp_servers: {
          fixture: {
            command: process.execPath,
            args: [fixture, marker],
            env: {},
            tools: { include: ["mutate"] },
          },
        },
      },
      { env: {}, profileDir: root }
    );
    await assert.rejects(
      callMcpTool(
        mcp,
        { server: "fixture", tool: "mutate", arguments: {} },
        { root, employeeId: "review", taskRunId: "task-intent" }
      ),
      /not a directory|component/i
    );
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP reports a non-retryable indeterminate result if settlement fails after the effect", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-mcp-settlement-"));
  const fixture = join(root, "fake-mcp.mjs");
  const marker = join(root, "effect.log");
  const auditDir = join(root, ".crewclaw", "mcp", "review");
  const intentDir = `${auditDir}-intent`;
  writeFileSync(
    fixture,
    `import{appendFileSync,renameSync,writeFileSync}from"node:fs";let buffer="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{buffer+=chunk;const lines=buffer.split(/\\r?\\n/);buffer=lines.pop()||"";for(const line of lines){if(!line.trim())continue;const m=JSON.parse(line);if(!Object.hasOwn(m,"id"))continue;let result={};if(m.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}};if(m.method==="tools/list")result={tools:[{name:"mutate",inputSchema:{type:"object"}}]};if(m.method==="tools/call"){appendFileSync(process.argv[2],"effect\\n");renameSync(process.argv[3],process.argv[4]);writeFileSync(process.argv[3],"block settlement");result={content:[{type:"text",text:"done"}]};}process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n");}});`,
    "utf8"
  );
  try {
    const mcp = parseMcpConfig(
      {
        mcp_servers: {
          fixture: {
            command: process.execPath,
            args: [fixture, marker, auditDir, intentDir],
            env: {},
            tools: { include: ["mutate"] },
          },
        },
      },
      { env: {}, profileDir: root }
    );
    await assert.rejects(
      callMcpTool(
        mcp,
        { server: "fixture", tool: "mutate", arguments: {} },
        { root, employeeId: "review", taskRunId: "task-settlement" }
      ),
      error =>
        error?.code === "external_effect_may_have_succeeded" &&
        error?.nonRetryable === true &&
        /禁止自动重试/.test(error.message)
    );
    assert.equal(readFileSync(marker, "utf8"), "effect\n");
    const intents = readdirSync(intentDir);
    assert.equal(intents.length, 1);
    assert.equal(
      JSON.parse(readFileSync(join(intentDir, intents[0]), "utf8")).status,
      "started"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Shrimp uses the maintained official GitHub MCP in read-only fail-closed mode", () => {
  const profile = JSON.parse(
    readFileSync(
      new URL("../../../experts/code-review-shrimp/mcp.json", import.meta.url),
      "utf8"
    )
  );
  const unavailable = parseMcpConfig(profile, {
    env: {},
    profileDir: "experts/code-review-shrimp",
  });
  const server = unavailable.servers.github;
  assert.equal(server.command, "docker");
  assert.ok(server.args.includes("ghcr.io/github/github-mcp-server"));
  assert.equal(server.env.GITHUB_READ_ONLY, "1");
  assert.deepEqual(server.missing_env, ["GITHUB_PERSONAL_ACCESS_TOKEN"]);
  assert.equal(server.ready, false);
  assert.deepEqual(mcpReadiness(unavailable), {
    ready: false,
    status: "blocked",
    providers: [],
    servers: [
      {
        name: "github",
        ready: false,
        missing_env: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
      },
    ],
  });
  assert.match(
    unavailable.indexText,
    /unavailable.*GITHUB_PERSONAL_ACCESS_TOKEN/
  );
  assert.deepEqual(server.include, [
    "search_code",
    "get_file_contents",
    "issue_read",
    "pull_request_read",
  ]);

  const configured = parseMcpConfig(profile, {
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "test-token-never-logged" },
    profileDir: "experts/code-review-shrimp",
  });
  assert.deepEqual([...configured.providers], ["mcp.github"]);
  assert.deepEqual(mcpReadiness(configured), {
    ready: true,
    status: "ready",
    providers: ["mcp.github"],
    servers: [{ name: "github", ready: true, missing_env: [] }],
  });
  assert.doesNotMatch(configured.indexText, /test-token/);
});

test("ready MCP tools remain per-call authorized in the live employee profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "crewclaw-mcp-policy-"));
  try {
    const profile = await loadProfile("code-review-shrimp", {
      workspaceRoot: root,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "test-token-never-logged" },
      surface: "chat",
    });
    const policy = profile.toolResolution.employeePolicy.tools.mcp_call;
    assert.equal(policy.permission, "requires_authorization");
    assert.equal(policy.approval, "always");
    assert.equal(policy.authorization, "per_call");

    const catalog = profile.toolResolution.sessionCatalog.find(
      item => item.runtime_tool === "mcp_call"
    );
    assert.equal(catalog.permission, "requires_authorization");
    assert.equal(catalog.authorization, "per_call");
    assert.equal(catalog.risk_tier, "P1");
    assert.deepEqual(runtimeToolReadiness(profile.toolResolution, "mcp_call"), {
      runtime_tool: "mcp_call",
      ready: true,
      availability: "ready",
      code: "ready",
      reason: "运行时 handler 已注册",
      provider: null,
      capabilities: ["mcp.read"],
    });

    const decision = employeeAgentLoopDeps(profile, root).gateway.check(
      "mcp_call",
      {
        server: "github",
        tool: "get_file_contents",
        arguments: { owner: "github", repo: "github-mcp-server" },
      }
    );
    assert.equal(decision.decision, "confirm");
    assert.equal(decision.decision_source, "employee_policy");
    assert.equal(decision.scope, "external_mcp");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
