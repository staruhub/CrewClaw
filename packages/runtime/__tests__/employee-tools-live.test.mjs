import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";

import {
  TOOL_CATALOG,
  agentLoop,
  createTaskEvidenceCard,
  denyUnavailableApproval,
  employeeAgentLoopDeps,
  loadProfile,
  normalizeOfficialDomains,
  runTool,
} from "../run.mjs";
import {
  configuredProvidersFromEnv,
  resolveEmployeeTools,
} from "../employee-tools.mjs";
import { startJsonlBridge } from "../tui/jsonl-bridge.mjs";

const expectedVisible = {
  "ai-adoption-whale": [
    "artifact_write",
    "ask_user",
    "docx_write",
    "note_memory",
    "recall_memory",
    "todo_write",
    "use_skill",
    "web_fetch",
    "web_search",
  ],
  "code-review-shrimp": [
    "artifact_write",
    "ask_user",
    "docx_write",
    "git_diff",
    "git_status",
    "list_files",
    "note_memory",
    "read_file",
    "recall_memory",
    "search",
    "todo_write",
    "use_skill",
  ],
  "product-prd-crab": [
    "artifact_write",
    "ask_user",
    "docx_write",
    "list_files",
    "note_memory",
    "read_file",
    "recall_memory",
    "todo_write",
    "use_skill",
  ],
  "macao-networking-agent": [
    "artifact_write",
    "ask_user",
    "docx_write",
    "note_memory",
    "recall_memory",
    "todo_write",
    "use_skill",
    "web_fetch",
    "web_search",
  ],
  zeneth: [
    "artifact_write",
    "ask_user",
    "docx_write",
    "list_files",
    "note_memory",
    "read_file",
    "recall_memory",
    "todo_write",
    "use_skill",
  ],
};
const forbidden = ["bash", "edit_file", "write_file"];
const loadedProfiles = new Map();
const configuredSearchEnv = {
  ...process.env,
  TAVILY_API_KEY: "configured-for-test",
};
const emptyProfileRoot = await mkdtemp(join(tmpdir(), "crewclaw-tools-empty-"));
await mkdir(join(emptyProfileRoot, ".crewclaw"));
await writeFile(join(emptyProfileRoot, ".crewclaw", "team.json"), "[]");

for (const [employeeId, expected] of Object.entries(expectedVisible)) {
  const profile = await loadProfile(employeeId, {
    workspaceRoot: emptyProfileRoot,
    env: configuredSearchEnv,
    surface: "chat",
  });
  loadedProfiles.set(employeeId, profile);
  const tooling = employeeAgentLoopDeps(profile);
  const names = tooling.tools.map(tool => tool.function.name).sort();
  assert.deepEqual(names, [...expected].sort(), `${employeeId} visible tools`);
  assert.equal(
    names.some(name => forbidden.includes(name)),
    false,
    `${employeeId} does not leak global mutation or shell tools`
  );
  for (const name of forbidden) {
    assert.equal(
      tooling.gateway.check(name, { path: "README.md", command: "git status" })
        .decision,
      "deny",
      `${employeeId} gateway fails closed for ${name}`
    );
  }

  let requestTools = null;
  let requestSystem = null;
  const output = await agentLoop({
    baseUrl: "http://mock.invalid",
    apiKey: "mock",
    model: "mock-model",
    temperature: 0,
    system: profile.system,
    messages: [{ role: "user", content: "mock turn" }],
    name: employeeId,
    isTTY: false,
    renderMd: false,
    ...tooling,
    onDelta() {},
    callModelFn: async options => {
      requestTools = options.tools.map(tool => tool.function.name).sort();
      requestSystem = options.system;
      options.onDelta?.("mock answer");
      return {
        content: "mock answer",
        usage: { prompt_tokens: 1, completion_tokens: 2 },
        toolCalls: [],
      };
    },
  });
  assert.equal(output, "mock answer");
  assert.deepEqual(
    requestTools,
    names,
    `${employeeId} live request is filtered`
  );
  assert.equal(
    profile.toolResolution.sessionCatalog.find(
      item => item.capability === "artifact.report"
    )?.availability,
    "ready",
    `${employeeId} advertises managed artifact persistence in Chat`
  );
  if (employeeId === "ai-adoption-whale") {
    assert.match(requestSystem, /HTTP 200 只证明页面可读取/);
    assert.doesNotMatch(requestSystem, /HTTP 200 的正文就是可信来源/);
  }
}

// Conditional capabilities are selected only by the frozen workspace grant snapshot.  The
// ungranted profiles above prove they do not leak into a normal chat request; this separate
// profile proves an explicit grant makes the same capability callable, while its per-call
// approval still remains enforced below.
const grantedProfileRoot = await mkdtemp(
  join(tmpdir(), "crewclaw-tools-grant-")
);
await mkdir(join(grantedProfileRoot, ".crewclaw"));
await writeFile(
  join(grantedProfileRoot, ".crewclaw", "team.json"),
  JSON.stringify([
    {
      employee_id: "code-review-shrimp",
      status: "active",
      permissions_granted: ["capability:test.run"],
    },
  ])
);
const codeReviewWithTestGrant = await loadProfile("code-review-shrimp", {
  workspaceRoot: grantedProfileRoot,
  env: configuredSearchEnv,
  surface: "chat",
});
assert.ok(
  employeeAgentLoopDeps(codeReviewWithTestGrant).tools.some(
    tool => tool.function.name === "test_run"
  ),
  "an explicit frozen capability grant exposes conditional test.run"
);
assert.equal(
  codeReviewWithTestGrant.toolResolution.sessionCatalog.find(
    item => item.capability === "test.run"
  )?.granted,
  true
);

const macao = loadedProfiles.get("macao-networking-agent");
assert.equal(
  macao.toolResolution.resolved.find(
    item => item.capability === "places.search"
  )?.availability,
  "not_granted",
  "an unselected conditional adapter does not probe provider readiness"
);
assert.equal(
  configuredProvidersFromEnv({
    GOOGLE_MAPS_API_KEY: "credential-is-not-a-handler",
    PLACES_API_KEY: "credential-is-not-a-handler",
    CREW_CONTACTS_PROVIDER: "contacts",
    CREW_CALENDAR_PROVIDER: "calendar",
  }).size,
  0,
  "credentials alone never make an adapter executable"
);
const credentialOnlyPlaces = resolveEmployeeTools({
  catalog: TOOL_CATALOG,
  toolNeeds: {
    "places.search": {
      necessity: "conditional",
      permission: "requires_authorization",
      description: "search configured place providers",
    },
  },
  grants: ["places.search"],
  configuredProviders: configuredProvidersFromEnv({ PLACES_API_KEY: "x" }),
});
assert.equal(
  credentialOnlyPlaces.resolved[0].availability,
  "unavailable",
  "an explicitly granted adapter remains unavailable until an executable handler is configured"
);

// Task evidence uses one normalized official-domain snapshot for both source planning and cards.
{
  const officialDomains = normalizeOfficialDomains([
    "HTTPS://VolcEngine.com/docs",
    "*.console.volcengine.com",
  ]);
  assert.deepEqual(officialDomains, [
    "volcengine.com",
    "console.volcengine.com",
  ]);
  const officialCard = createTaskEvidenceCard(
    "https://docs.volcengine.com/seed",
    {
      officialDomains,
      degraded: false,
    }
  );
  assert.equal(officialCard.source_type, "official");
  assert.equal(officialCard.confidence, "high");
  const lookalikeCard = createTaskEvidenceCard(
    "https://volcengine.com.evil.example/seed",
    {
      officialDomains,
      degraded: false,
    }
  );
  assert.equal(lookalikeCard.source_type, "unknown");
  assert.equal(lookalikeCard.confidence, "low");
  assert.equal(
    createTaskEvidenceCard("https://volcengine.com/seed", {
      officialDomains: normalizeOfficialDomains(),
      degraded: false,
    }).source_type,
    "unknown",
    "a task without research hints must not infer an official domain"
  );
}
const zeneth = loadedProfiles.get("zeneth");
assert.equal(
  zeneth.toolResolution.resolved.find(
    item => item.capability === "broadcast.draft"
  )?.availability,
  "not_granted",
  "an unselected conditional engine capability does not probe implementation readiness"
);

// session.ready carries both the canonical catalog and this employee's resolved four-dimensional
// declaration/availability/permission/authorization view.
{
  const input = new PassThrough();
  const output = new PassThrough();
  let jsonl = "";
  output.on("data", chunk => {
    jsonl += chunk;
  });
  const bridgeRoot = await mkdtemp(join(tmpdir(), "crewclaw-tools-bridge-"));
  const whale = loadedProfiles.get("ai-adoption-whale");
  const done = startJsonlBridge({
    input,
    output,
    agentLoop: async () => "unused",
    agentLoopDeps: employeeAgentLoopDeps(whale),
    agentName: "AI Adoption Whale",
    meta: {
      mode: "Chat",
      agentId: "ai-adoption-whale",
      toolCatalogVersion: TOOL_CATALOG.version,
      canonicalToolCatalog: TOOL_CATALOG.capabilities,
      toolCatalog: whale.toolResolution.sessionCatalog,
      toolBlocking: whale.toolResolution.blocking,
      toolDegraded: whale.toolResolution.degraded,
    },
    history: [],
    root: bridgeRoot,
  });
  input.end();
  await done;
  const ready = jsonl
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line))
    .find(event => event.type === "session.ready");
  assert.equal(
    ready.data.tool_catalog.capabilities.length,
    TOOL_CATALOG.capabilities.length
  );
  const declaration = ready.data.tool_catalog.resolution.find(
    item => item.capability === "browser.render"
  );
  assert.equal(declaration.necessity, "conditional");
  assert.equal(declaration.permission, "requires_authorization");
  assert.equal(declaration.authorization, "not_granted");
  assert.equal(declaration.availability, "not_granted");
  assert.equal(declaration.code, "not_granted");
  assert.equal(ready.data.tool_catalog.surface, "chat");
  await rm(bridgeRoot, { recursive: true, force: true });
}

// Structured repository tools take closed arguments. test_run executes only an exact, safe
// package script; a model-provided arbitrary lifecycle script is rejected before execution.
{
  const root = await mkdtemp(join(tmpdir(), "crewclaw-structured-tools-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node -e \"process.stdout.write('SAFE_TEST_RUN')\"",
          "test:ink":
            "node -e \"require('fs').writeFileSync('ink-auto-approved','yes')\"",
          postinstall: "node -e \"process.stdout.write('UNSAFE')\"",
        },
      })
    );
    const git = (...args) =>
      spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(git("init").status, 0);
    assert.equal(git("config", "user.name", "CrewClaw Test").status, 0);
    assert.equal(
      git("config", "user.email", "test@crewclaw.invalid").status,
      0
    );
    await writeFile(join(root, "tracked.txt"), "before\n");
    await writeFile(
      join(root, ".gitignore"),
      "redirected/\nignored-secret.txt\n"
    );
    assert.equal(git("add", "tracked.txt", ".gitignore").status, 0);
    assert.equal(git("commit", "-m", "fixture").status, 0);
    await writeFile(join(root, "tracked.txt"), "after\n");

    const searchSecret = "TOP_SECRET_SEARCH_MARKER";
    const ignoredSecret = "GITIGNORED_SEARCH_MARKER";
    await writeFile(
      join(root, ".env.local"),
      `ZENMUX_API_KEY=${searchSecret}\n`
    );
    await writeFile(
      join(root, "credentials.json"),
      JSON.stringify({ token: searchSecret })
    );
    await writeFile(join(root, "private-key.pem"), searchSecret);
    await writeFile(join(root, "ignored-secret.txt"), ignoredSecret);
    await writeFile(join(root, "pathological.txt"), `${"a".repeat(5000)}!\n`);

    const allowRead = { decision: "allow", level: "L1", scope: "workspace" };
    const redirected = join(root, "redirected");
    await mkdir(redirected);
    assert.equal(
      spawnSync("git", ["init"], { cwd: redirected, encoding: "utf8" }).status,
      0
    );
    const poisonedGitEnv = {
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    };
    process.env.GIT_DIR = join(redirected, ".git");
    process.env.GIT_WORK_TREE = redirected;
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "invalid key";
    process.env.GIT_CONFIG_VALUE_0 = "ignored";
    let diff;
    let status;
    try {
      diff = await runTool("git_diff", {}, { permission: allowRead, root });
      status = await runTool("git_status", {}, { permission: allowRead, root });
    } finally {
      for (const [key, value] of Object.entries(poisonedGitEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    assert.match(diff, /\+after/);
    assert.match(status, /tracked\.txt/);
    assert.doesNotMatch(status, /redirected/);

    const injectedMarker = join(root, "search-injected");
    // 关键安全不变量：恶意 query 只作为搜索"模式"，绝不经 shell → 注入的 touch 不得执行。
    // 该不变量与搜索引擎无关：ripgrep 可能拒绝非法正则；缺 rg 时的内置回退把输入当安全
    // 字面量搜索。两条路径都必须满足"marker 不被创建"。
    try {
      await runTool(
        "search",
        { query: `no-match'; touch '${injectedMarker}' #`, path: "." },
        { permission: allowRead, root }
      );
    } catch (error) {
      assert.equal(error?.code, "tool_process_failed");
      assert.match(error.message, /regex parse error/);
    }
    assert.equal(
      existsSync(injectedMarker),
      false,
      "repo search passes model text as a search pattern, never through a shell"
    );

    const sensitiveResult = await runTool(
      "search",
      { query: searchSecret, path: "." },
      { permission: allowRead, root }
    );
    assert.doesNotMatch(
      sensitiveResult,
      new RegExp(searchSecret),
      "repository search must never return credential-file contents"
    );
    const ignoredResult = await runTool(
      "search",
      { query: ignoredSecret, path: "." },
      { permission: allowRead, root }
    );
    assert.doesNotMatch(
      ignoredResult,
      new RegExp(ignoredSecret),
      "repository search must honor .gitignore for non-hidden files"
    );
    const rgAvailable =
      spawnSync("rg", ["--version"], {
        encoding: "utf8",
        windowsHide: true,
      }).status === 0;
    if (rgAvailable) {
      await assert.rejects(
        runTool(
          "search",
          { query: ignoredSecret, path: "ignored-secret.txt" },
          { permission: allowRead, root }
        ),
        error =>
          error?.code === "invalid_tool_arguments" &&
          /Git ignore|许可集/.test(error.message)
      );
    }
    await assert.rejects(
      runTool(
        "search",
        { query: "ZENMUX", path: ".env.local" },
        { permission: allowRead, root }
      ),
      error =>
        error?.code === "invalid_tool_arguments" &&
        /敏感凭据/.test(error.message)
    );

    // Force a fresh process onto the no-rg branch. The adversarial regex-shaped text must be
    // treated literally and finish before the child timeout; credential files remain excluded.
    const gitOnlyEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path"
      )
    );
    const currentPath =
      Object.entries(process.env).find(
        ([key]) => key.toLowerCase() === "path"
      )?.[1] || "";
    const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
    const gitBin = currentPath
      .split(process.platform === "win32" ? ";" : ":")
      .find(dir => dir && existsSync(join(dir, gitExecutable)));
    assert.ok(gitBin, "test requires git on PATH");
    gitOnlyEnv.PATH = gitBin;
    const fallbackProbe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { runTool } from ${JSON.stringify(new URL("../run.mjs", import.meta.url).href)};
          const permission = { decision: "allow", level: "L1", scope: "workspace" };
          const root = ${JSON.stringify(root)};
          const pathological = await runTool("search", { query: "(a+)+$", path: "." }, { permission, root });
          const secret = await runTool("search", { query: ${JSON.stringify(searchSecret)}, path: "." }, { permission, root });
          const ignored = await runTool("search", { query: ${JSON.stringify(ignoredSecret)}, path: "." }, { permission, root });
          const deniedCode = async path => {
            try {
              await runTool("search", { query: "secret", path }, { permission, root });
              return "allowed";
            } catch (error) {
              return error?.code || "unknown";
            }
          };
          const ignoredDirect = await deniedCode("ignored-secret.txt");
          const gitConfigDirect = await deniedCode(".git/config");
          process.stdout.write(JSON.stringify({ pathological, secret, ignored, ignoredDirect, gitConfigDirect }));
        `,
      ],
      { encoding: "utf8", env: gitOnlyEnv, timeout: 8000 }
    );
    assert.equal(
      fallbackProbe.error?.code,
      undefined,
      "literal fallback must not hang on regex-shaped model input"
    );
    assert.equal(fallbackProbe.status, 0, fallbackProbe.stderr);
    const fallbackResults = JSON.parse(fallbackProbe.stdout);
    assert.doesNotMatch(fallbackResults.secret, new RegExp(searchSecret));
    assert.doesNotMatch(fallbackResults.ignored, new RegExp(ignoredSecret));
    assert.match(fallbackResults.pathological, /内置搜索回退/);
    assert.equal(fallbackResults.ignoredDirect, "invalid_tool_arguments");
    assert.equal(fallbackResults.gitConfigDirect, "invalid_tool_arguments");

    const confirmExecute = {
      decision: "confirm",
      level: "L2",
      scope: "workspace",
    };
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      throw new Error("network handler must not run before confirmation");
    };
    const readMarker = "READ_HANDLER_MUST_NOT_RUN";
    await writeFile(join(root, "approval-marker.txt"), readMarker);
    try {
      for (const [name, args] of [
        ["web_fetch", { url: "https://example.com/source" }],
        ["web_search", { query: "CrewClaw" }],
        ["read_file", { path: "approval-marker.txt" }],
      ]) {
        const denied = await runTool(name, args, {
          permission: confirmExecute,
          confirm: async () => false,
          root,
        });
        assert.match(denied, /未获授权/);
        assert.doesNotMatch(denied, new RegExp(readMarker));
      }
      assert.equal(
        fetchCalls,
        0,
        "confirmation denial happens before web handlers"
      );

      // A denied explicit-file search must not launch the Git permission enumerator.
      const savedPath = process.env.PATH;
      process.env.PATH = "";
      try {
        const deniedSearch = await runTool(
          "search",
          { query: readMarker, path: "approval-marker.txt" },
          {
            permission: confirmExecute,
            confirm: async () => false,
            root,
          }
        );
        assert.match(deniedSearch, /未获授权/);
      } finally {
        if (savedPath === undefined) delete process.env.PATH;
        else process.env.PATH = savedPath;
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
    const safe = await runTool(
      "test_run",
      { script: "test" },
      { permission: confirmExecute, confirm: async () => true, root }
    );
    assert.match(safe, /SAFE_TEST_RUN/);
    await assert.rejects(
      runTool(
        "test_run",
        { script: "postinstall" },
        { permission: confirmExecute, confirm: async () => true, root }
      ),
      error =>
        error?.code === "invalid_tool_arguments" &&
        /只接受仓库定义/.test(error.message)
    );

    const codeReview = codeReviewWithTestGrant;
    const toolEvents = [];
    let modelStep = 0;
    await agentLoop({
      baseUrl: "http://mock.invalid",
      apiKey: "mock",
      model: "mock-model",
      temperature: 0,
      system: codeReview.system,
      messages: [{ role: "user", content: "run tests" }],
      name: "Code Review Shrimp",
      isTTY: false,
      renderMd: false,
      ...employeeAgentLoopDeps(codeReview, root),
      confirm: denyUnavailableApproval,
      onDelta() {},
      onToolEvent: event => toolEvents.push(event),
      callModelFn: async () => {
        modelStep += 1;
        return modelStep === 1
          ? {
              content: "",
              usage: null,
              toolCalls: [
                {
                  id: "ink-confirm",
                  type: "function",
                  function: {
                    name: "test_run",
                    arguments: JSON.stringify({ script: "test:ink" }),
                  },
                },
              ],
            }
          : { content: "blocked safely", usage: null, toolCalls: [] };
      },
    });
    assert.equal(existsSync(join(root, "ink-auto-approved")), false);
    assert.deepEqual(
      toolEvents
        .filter(event => event.id === "ink-confirm")
        .map(event => event.phase),
      ["requested", "running", "blocked"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await Promise.all([
  rm(emptyProfileRoot, { recursive: true, force: true }),
  rm(grantedProfileRoot, { recursive: true, force: true }),
]);

console.log("employee tools live tests passed");
