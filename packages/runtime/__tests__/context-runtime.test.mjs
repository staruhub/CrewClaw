import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";

import {
  activeSkillToolPolicy,
  buildIndexedSystem,
  buildMemoryIndex,
  buildSkillCatalog,
  buildSkillIndex,
  loadRecalledMemory,
  memoryId,
} from "../context-runtime.mjs";
import {
  agentLoop,
  employeeAgentLoopDeps,
  loadProfile,
  runTool,
} from "../run.mjs";
import { createTaskRun } from "../tui/event-bridge.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, message, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await pause(10);
  }
  assert.fail(message);
}

const skillFile = (name, description, body = "Follow the full guide.") => ({
  relativePath: `skills/${name}/SKILL.md`,
  text: `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`,
});

{
  const catalog = buildSkillCatalog([
    {
      relativePath: "skills/manual-deploy/SKILL.md",
      text: `---\nname: manual-deploy\ndescription: User-controlled deployment workflow.\ndisable-model-invocation: true\nallowed-tools: Bash(git status *) Bash(git push *)\n---\n\n# Manual deploy\n`,
    },
    {
      relativePath: "skills/background-rules/SKILL.md",
      text: `---\nname: background-rules\ndescription: Model-only background conventions.\nuser-invocable: false\nallowed-tools:\n  - read_file\n  - list_files\n---\n\n# Background rules\n`,
    },
  ]);
  assert.deepEqual(catalog[0].allowedTools, [
    "Bash(git status *)",
    "Bash(git push *)",
  ]);
  assert.equal(catalog[0].userInvocable, true);
  assert.equal(catalog[0].modelInvocable, false);
  assert.deepEqual(catalog[1].allowedTools, ["read_file", "list_files"]);
  assert.equal(catalog[1].userInvocable, false);
  assert.equal(catalog[1].modelInvocable, true);

  const index = buildSkillIndex(catalog, { contextTokens: 20_000 });
  assert.doesNotMatch(index.text, /manual-deploy/);
  assert.match(index.text, /background-rules/);
  assert.match(index.text, /tools: read_file, list_files/);

  assert.equal(
    activeSkillToolPolicy(catalog, ["background-rules"], "read_file").allowed,
    true
  );
  assert.equal(
    activeSkillToolPolicy(catalog, ["background-rules"], "artifact_write")
      .allowed,
    false
  );
  assert.equal(
    activeSkillToolPolicy(catalog, ["background-rules"], "use_skill").allowed,
    true,
    "skill composition stays possible without granting any executable tool"
  );

  assert.throws(
    () =>
      buildSkillCatalog([
        {
          relativePath: "skills/bad/SKILL.md",
          text: `---\nname: bad\ndescription: bad visibility\nuser-invocable: yes\n---\nbody`,
        },
      ]),
    /user-invocable must be a boolean/
  );
}

{
  const root = mkdtempSync(join(tmpdir(), "crewclaw-skill-boundary-"));
  const catalog = buildSkillCatalog([
    {
      relativePath: "skills/read-only-review/SKILL.md",
      text: `---\nname: read-only-review\ndescription: Review without modifying files.\nallowed-tools: read_file list_files\n---\n\n# Read only review\nNever write files.\n`,
    },
    {
      relativePath: "skills/manual-only/SKILL.md",
      text: `---\nname: manual-only\ndescription: Only a user may start this skill.\ndisable-model-invocation: true\n---\n\n# Manual only\n`,
    },
  ]);
  try {
    let modelCalls = 0;
    let executed = 0;
    const lifecycle = [];
    const launched = [];
    const output = await agentLoop({
      baseUrl: "http://mock.invalid",
      apiKey: "mock",
      model: "mock",
      temperature: 0,
      system: "Employee system",
      messages: [{ role: "user", content: "review this" }],
      name: "Reviewer",
      isTTY: false,
      renderMd: false,
      root,
      employeeId: "skill-worker",
      skillCatalog: catalog,
      initialSkillIds: ["read-only-review"],
      tools: [],
      gateway: {
        check: () => ({
          decision: "allow",
          level: "L1",
          scope: "workspace",
          decision_source: "test",
        }),
      },
      onDelta() {},
      onSkillLaunched: event => launched.push(event),
      onToolEvent: event => lifecycle.push(event),
      runToolFn: async () => {
        executed += 1;
        return "unexpected execution";
      },
      callModelFn: async options => {
        modelCalls += 1;
        assert.match(options.system, /# Read only review/);
        if (modelCalls === 1) {
          return {
            content: "",
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            toolCalls: [
              {
                id: "write-call",
                type: "function",
                function: {
                  name: "artifact_write",
                  arguments: JSON.stringify({
                    path: "report.md",
                    content: "x",
                  }),
                },
              },
            ],
          };
        }
        return {
          content: "blocked safely",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          toolCalls: [],
        };
      },
    });
    assert.equal(output, "blocked safely");
    assert.equal(executed, 0, "skill boundary blocks before the executor");
    assert.equal(launched.length, 1);
    assert.equal(launched[0].source, "user");
    assert.ok(
      lifecycle.some(
        event =>
          event.phase === "blocked" &&
          event.decision?.decision_source === "skill_allowed_tools"
      )
    );

    await assert.rejects(
      () =>
        runTool(
          "use_skill",
          { id: "manual-only" },
          {
            permission: {
              decision: "allow",
              level: "L1",
              scope: "skills",
            },
            root,
            employeeId: "skill-worker",
            skillCatalog: catalog,
          }
        ),
      /禁止模型调用/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const catalog = buildSkillCatalog([
    skillFile("rare", `Use when ${"r".repeat(220)}.`),
    skillFile("frequent", `Use when ${"f".repeat(220)}.`),
  ]);
  const index = buildSkillIndex(catalog, {
    contextTokens: 24_000,
    usage: { frequent: { count: 10 }, rare: { count: 0 } },
  });
  assert.ok(index.estimatedTokens <= index.budgetTokens);
  assert.ok(index.included.some(skill => skill.id === "frequent"));
  if (index.dropped.length > 0) {
    assert.equal(index.dropped[0].id, "rare", "least-used skill drops first");
  }
  assert.doesNotMatch(index.text, /Follow the full guide/);
}

{
  const memories = Array.from({ length: 50 }, (_, index) => ({
    category: index % 2 ? "project_facts" : "verified_sops",
    confidence: index < 40 ? "high" : "medium",
    text: `Memory ${index}: ${"verified detail ".repeat(80)}tail-${index}`,
    savedAt: new Date(1_700_000_000_000 + index).toISOString(),
  }));
  const index = buildMemoryIndex(memories, { budgetTokens: 1_000 });
  assert.ok(index.estimatedTokens <= 1_000);
  assert.ok(
    index.estimatedTokens < index.fullEstimatedTokens / 3,
    `index ${index.estimatedTokens} must be under one third of full ${index.fullEstimatedTokens}`
  );
  assert.ok(index.included.length > 0);
  assert.match(index.text, new RegExp(index.included[0].id));
  assert.ok(
    index.included.every(entry => entry.confidence === "high"),
    "lower-confidence memories cannot displace high-confidence entries"
  );
  assert.doesNotMatch(index.text, /tail-\d+/);
}

{
  const index = buildMemoryIndex(
    [
      { text: "missing confidence", savedAt: "2024-01-01T00:00:00Z" },
      {
        text: "explicit low confidence",
        confidence: "low",
        savedAt: "2024-01-01T00:00:00Z",
      },
    ],
    { budgetTokens: 1_000 }
  );
  assert.deepEqual(
    index.included.map(entry => entry.confidence),
    ["low", "unknown"],
    "an explicit low-confidence memory ranks ahead of missing confidence"
  );
}

{
  const root = mkdtempSync(join(tmpdir(), "crewclaw-index-context-"));
  try {
    mkdirSync(join(root, ".crewclaw", "memory"), { recursive: true });
    const memory = {
      category: "project_facts",
      confidence: "high",
      text: `The public summary begins here. ${"private detail ".repeat(30)}SECRET_TAIL`,
      savedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(root, ".crewclaw", "memory", "ai-adoption-whale.json"),
      JSON.stringify([memory])
    );
    const profile = await loadProfile("ai-adoption-whale", {
      workspaceRoot: root,
      env: {
        TAVILY_API_KEY: "test",
        HERMES_MODEL: "x-ai/grok-4.5",
      },
    });
    assert.equal(profile.contextTokens, 500_000);
    assert.equal(profile.contextIndex.skills.budgetTokens, 5_000);
    assert.match(profile.system, /Installed Skills \(index\)/);
    assert.match(profile.system, /Memory \(index\)/);
    assert.match(profile.memoryStateHash, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(profile.system, /# ROI Estimator/);
    assert.doesNotMatch(profile.system, /SECRET_TAIL/);
    assert.match(
      loadRecalledMemory(root, "ai-adoption-whale", { id: memoryId(memory) }),
      /SECRET_TAIL/
    );
    const rebuilt = profile.refreshContext();
    assert.equal(rebuilt.memoryStateHash, profile.memoryStateHash);
    assert.equal(
      rebuilt.contextIndex.memory.included.length,
      profile.contextIndex.memory.included.length
    );

    let modelCalls = 0;
    let toolBody = "";
    const launched = [];
    const messages = [{ role: "user", content: "Estimate ROI" }];
    const output = await agentLoop({
      baseUrl: "http://mock.invalid",
      apiKey: "mock",
      model: "mock",
      temperature: 0,
      system: profile.system,
      messages,
      name: "Whale",
      isTTY: false,
      renderMd: false,
      ...employeeAgentLoopDeps(profile, root),
      root,
      onDelta() {},
      onSkillLaunched: event => launched.push(event),
      callModelFn: async options => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: "",
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            toolCalls: [
              {
                id: "skill-call",
                type: "function",
                function: {
                  name: "use_skill",
                  arguments: JSON.stringify({ id: "roi-estimator" }),
                },
              },
            ],
          };
        }
        toolBody = String(options.messages.at(-1)?.content || "");
        return {
          content: "ROI ready",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          toolCalls: [],
        };
      },
    });
    assert.equal(output, "ROI ready");
    assert.match(toolBody, /# ROI Estimator/);
    assert.deepEqual(launched, [{ id: "skill-call", skill: "roi-estimator" }]);

    const task = createTaskRun({}, () => {});
    task.start("skill event");
    task.sink.onSkillLaunched({ id: "skill-call", skill: "roi-estimator" });
    assert.ok(
      task
        .get()
        .timeline.some(item => item.label.includes("启动技能：roi-estimator"))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// W1 live-path proof: a Ratatui-style JSONL session receives a non-zero indexed-memory count,
// recalls the full body only through recall_memory, and renders an answer that depends on it.
{
  const root = mkdtempSync(join(tmpdir(), "crewclaw-jsonl-memory-"));
  const input = new Readable({ read() {} });
  const events = [];
  let outputBuffer = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputBuffer += String(chunk);
      const lines = outputBuffer.split("\n");
      outputBuffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
      callback();
    },
  });
  try {
    mkdirSync(join(root, ".crewclaw", "memory"), { recursive: true });
    const memory = {
      category: "project_facts",
      confidence: "high",
      text: "The launch code is MEMORY_FROM_JSONL_7429.",
      savedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(root, ".crewclaw", "memory", "ai-adoption-whale.json"),
      JSON.stringify([memory])
    );
    const profile = await loadProfile("ai-adoption-whale", {
      workspaceRoot: root,
      env: {
        TAVILY_API_KEY: "test",
        HERMES_MODEL: "x-ai/grok-4.5",
      },
    });
    const done = startJsonlBridge({
      root,
      input,
      output,
      agentName: "鲸",
      meta: {
        agentId: "ai-adoption-whale",
        role: profile.title,
        mode: "Chat",
        model: "mock",
        contextIndex: profile.contextIndex,
        contextTokens: profile.contextTokens,
      },
      agentLoop: async options => {
        const body = loadRecalledMemory(root, "ai-adoption-whale", {
          id: memoryId(memory),
        });
        options.onToolEvent({
          id: "memory-call",
          toolName: "recall_memory",
          phase: "requested",
          args: { id: memoryId(memory) },
        });
        options.onToolEvent({
          id: "memory-call",
          toolName: "recall_memory",
          phase: "running",
        });
        options.onToolEvent({
          id: "memory-call",
          toolName: "recall_memory",
          phase: "succeeded",
          summary: "已读取索引记忆",
          detail: body,
        });
        assert.match(body, /MEMORY_FROM_JSONL_7429/);
        options.onDelta("记忆校验：MEMORY_FROM_JSONL_7429");
        return "记忆校验：MEMORY_FROM_JSONL_7429";
      },
    });

    const ready = await waitFor(
      () => events.find(event => event.type === "session.ready"),
      "JSONL session.ready missing"
    );
    assert.ok(ready.data.context_index.memory.included > 0);
    assert.equal(ready.data.context_index.memory.body_injected, false);
    await pause(10);
    assert.ok(
      input.listenerCount("data") > 0,
      "JSONL readline is not attached"
    );
    input.push("请完成项目事实核验：根据已有上下文给出启动代码并说明依据\n");
    await waitFor(
      () =>
        events.find(
          event =>
            event.type === "assistant.rendered" &&
            /MEMORY_FROM_JSONL_7429/.test(event.data.text)
        ),
      `JSONL TUI did not render the memory-dependent answer: ${JSON.stringify(events)}`
    );
    assert.ok(
      events.some(
        event =>
          event.type === "tool.succeeded" && event.data.tool === "recall_memory"
      )
    );
    input.push("/exit\n");
    await done;
  } finally {
    if (!input.destroyed) input.push(null);
    rmSync(root, { recursive: true, force: true });
  }
}

// A4 live-path proof: user-invocable skills enter the Ratatui slash catalog and carry an explicit
// initial-skill activation into the model turn; model-only skills stay out of the user menu.
{
  const root = mkdtempSync(join(tmpdir(), "crewclaw-jsonl-skill-command-"));
  const input = new Readable({ read() {} });
  const events = [];
  const seenInitialSkills = [];
  let outputBuffer = "";
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputBuffer += String(chunk);
      const lines = outputBuffer.split("\n");
      outputBuffer = lines.pop() || "";
      for (const line of lines) if (line.trim()) events.push(JSON.parse(line));
      callback();
    },
  });
  const skillCatalog = buildSkillCatalog([
    {
      relativePath: "skills/review-pr/SKILL.md",
      text: `---\nname: review-pr\ndescription: Review one pull request.\n---\n\n# Review PR\n`,
    },
    {
      relativePath: "skills/background-rules/SKILL.md",
      text: `---\nname: background-rules\ndescription: Internal rules.\nuser-invocable: false\n---\n\n# Background\n`,
    },
  ]);
  try {
    const done = startJsonlBridge({
      root,
      input,
      output,
      agentName: "审查员",
      meta: {
        agentId: "skill-worker",
        role: "Reviewer",
        mode: "Chat",
        model: "mock",
      },
      agentLoopDeps: { skillCatalog },
      agentLoop: async options => {
        seenInitialSkills.push(options.initialSkillIds);
        options.onDelta("技能命令已执行");
        return "技能命令已执行";
      },
    });
    const ready = await waitFor(
      () => events.find(event => event.type === "session.ready"),
      "skill JSONL session.ready missing"
    );
    assert.ok(
      ready.data.caps.commands.some(command => command.name === "/review-pr")
    );
    assert.ok(
      !ready.data.caps.commands.some(
        command => command.name === "/background-rules"
      )
    );
    input.push("/review-pr review this pull request carefully\n");
    await waitFor(
      () =>
        events.find(
          event =>
            event.type === "assistant.rendered" &&
            /技能命令已执行/.test(event.data.text)
        ),
      "user-invoked skill did not reach the model turn"
    );
    assert.deepEqual(seenInitialSkills.at(-1), ["review-pr"]);
    input.push("/exit\n");
    await done;
  } finally {
    if (!input.destroyed) input.push(null);
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("context-runtime.test.mjs passed");
