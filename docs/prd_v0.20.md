# CrewClaw v0.20 — 接线上桌 + 索引化平台层：让建成的能力被用到

> **Canonical ownership**：版本化源文件为 `crewhire/docs/prd_v0.20.md`；工作区根目录的本文件是同步镜像，
> 供跨仓规划与验收记录使用。RC 发布只认仓内版本，镜像变更必须同步回仓内文件，避免默认漏出 release commit。

依据：2026-07-16 五维架构评审（TUI 样式 / 员工工具 / Skills / 招雇 / Dream，全代码取证）

- Claude Code 官方机制对照调研（25 条主张，来源 code.claude.com 官方文档六篇：
  features-overview / hooks / memory / permissions / skills / sub-agents）。

一句话定位：**v0.18 证明了员工是真的，v0.19 把地基焊死了，v0.20 让已建成的能力真正被用到——
并抄下 Claude Code 的一个核心机制：索引常驻 + 按需取正文。**

> **2026-07-18 收官状态**：功能实现已越过原计划，当前进入 Release Candidate 收口。
> “代码存在”“live 路径已接通”“真实外部运行已证明”“可发布”是四个不同状态；本版只在
> §6.4 的 Exit Gate 全部有证据后宣告完成。2026-07-16 的全套件绿灯是历史验收快照，
> 不能替代 P1 修复后的重新验证。

---

## 0. 诊断（为什么是这个版本）

**系统病没变，但换了形态。** v0.17 审计的病是"能力是假的"（mock 冒真），已治愈；
本次评审发现的病是"**能力是真的，但没接进 live 面**"——五个维度反复出现同一模式：

| 症状                                                                                                                   | 证据                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `skill.launched` 协议+Rust/JS 双端渲染全就绪，引擎**从不发射**                                                         | protocol.rs:434 / state.rs:2492 / app-state.mjs:1241，全仓无发射点 |
| `ui-diff.mjs` 完整 diff 渲染器（LCS+着色+折叠），**只接 stdout 路径**，ratatui 里编辑结果是 dim 原文                   | ui-diff.mjs:76；grep diffCard 仅命中 run.mjs                       |
| 记忆注入 CLI 任务路径已通，**TUI chat 路径没接**——主推工位上员工失忆                                                   | run.mjs:5109 有 / tui/route.mjs 零调用 summarizeForPrompt          |
| Dream M1–M5 代码全实现（两道门/溯源/回滚/认证失效），**从未点火**：.crewclaw/dream 与 memory 全空，reflections 仅 1 条 | dream-controller.mjs 全套 / 磁盘实态                               |
| 文档"写"是空头支票：pdf/docx/xlsx 映射到**不存在的工具**，preflight 直接 block                                         | run.mjs:822 ARTIFACT_WRITERS_BY_EXTENSION                          |
| MCP 纸面：mcp.json 有声明有校验，runtime **零连接代码**；adapter 能力恒 unavailable                                    | employee-tools.mjs:537 configuredProviders 硬编码空 Set            |
| TUI 只能招不能辞；fire 仪式谎称 "package removed"（实为软删全保留）                                                    | workbench 无 fire 入口 / hire_demo.rs:226                          |

**对照 Claude Code（官方文档证实），缺三个整层**：① subagent/Task 编排；② hooks 生命周期体系；
③ 渐进式披露——CC 的 skills 描述常驻+正文按调用加载（清单预算=上下文 1%、单描述 1536 字符），
auto-memory 是 MEMORY.md 索引（前 200 行/25KB）+主题文件按需读。我们 skills 与记忆都是**全文注入**。
权限层是唯一不落下风的层（双层求交+fail-closed bash 比 CC 更严），保持不动。

**本版两个主轴**：M0 接线批（把已建成的能力逐条接进 live 面，全是小改）；
M1 索引化（skills+memory 同改"索引常驻+按需取正文"，一次架构决策解决
skills 展示断线、注入成本、Dream 召回三个已知问题）。subagent/hooks 是更大的工程，记入 §4 不做清单留给 v0.21。

---

## 1. 设计原则（承接 v0.18 边界宪章，新增两条）

- （承接）TUI=监督驾驶舱；网站=本地优先橱窗；TaskEvent additive-only；无真明示；Feature 三问准入。
- **新增·索引化原则**：任何"给模型的大块静态文本"（skills 正文 / 记忆正文 / 未来 MCP schema）
  一律改为"索引行常驻 + 工具按需取正文"。按需取正文的工具调用本身就是 UI 真信号——展示问题顺带解决。
- **新增·门禁不放松、流量要增加**：Dream 的两道门与激活硬条件一条不改；
  改的是喂料侧（轻采集）与消费侧（召回），让这台已建成的机器有东西可磨。

---

## 2. 里程碑

### M0 · 接线批（九件套，彼此独立可并行，每件都是小改）

| #   | 事项               | 改哪里                                                                                                                    | 验收                                                          |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| W1  | TUI chat 记忆注入  | tui 路径 runModelTurn 接 loadMemory→summarizeForPrompt（与 run.mjs:5109 同源，抽公共函数防双脑）                          | TUI 里问员工"你记得我什么"，答案来自 .crewclaw/memory 真条目  |
| W2  | diff 进 ratatui    | edit_file/write_file 的 tool.result 事件带预渲染 diff（复用 ui-diff.mjs，桥接层生成 ANSI）                                | TUI 里编辑文件，时间轴展开可见 +绿/-红 diff                   |
| W3  | 工具行参数摘要     | runtime canonical presenter 按工具类型生成 `name/args_summary/result_summary`；JSONL/内存桥只透传，Rust/Node reducer 消费 | 不展开即可知工具作用对象与结果统计，对齐 CC 的 `⏺ Tool(args)` |
| W4  | 忙态可发现性       | hint 行加 esc/Ctrl+C 中断提示；generation_phase 已有值，接入状态词（思考中/调用工具中/生成中）                            | 生成期间 hint 行三态可见，esc 真能断                          |
| W5  | TUI 解雇入口       | TEAM/MARKET 视图加 fire 动作，复用 PendingAction 确认模式，走既有 fire 服务                                               | TUI 内 hire→fire→re-hire 闭环，无需切网站/CLI                 |
| W6  | fire 诚实纠偏      | hire_demo.rs:226 仪式文案改为真语义（"记录保留·随时可重雇"）；HireConfirm.tsx:491 矛盾文案删除                            | 文案与软删除行为一致                                          |
| W7  | list_files 工具    | 补 handler+schema（分类座位 tool-gateway.mjs:234 已留），沙箱同 read_file                                                 | 员工能列目录/glob，不再借道 bash                              |
| W8  | hermes semver 比对 | flow_state.rs:526 hermes_status 解析 `--version` 输出，与 requires.hermes 真比对；不满足=Warning 带明示                   | 装 0.10 的机器 HIRE 屏不再给 ✓                                |
| W9  | KPI v1→v2 迁移     | 一次性迁移脚本：v1 台账(如鲸的 28 tasks)转 v2 legacy 分类明示，Performance 页不再静默低报                                 | /performance 显示迁移后真值或明示"legacy 未分类 N 条"         |

### M1 · 索引化（本版主轴，skills 与 memory 同一模式同批改）

**M1a Skills：**

- system prompt 只注入技能索引（name + "Use when…" description——validator 早已强制此格式，为的就是这天）；
  新增 `use_skill(id)` 运行时工具按需返回 SKILL.md 正文。
- `use_skill` 调用即发射 `skill.launched`（协议/渲染双端现成，纯接线）→ TUI 技能块复活，
  技能使用进时间轴、可计入 KPI。
- 预算抄 CC：索引清单 ≤ 上下文 1%，单条描述 ≤1536 字符，超限先丢最少使用的。
- 技能三概念对齐：validator 加交叉校验——`skills/**/SKILL.md` ↔ `hire.yaml:skills` 必须一致；
  `playbooks` 改名或明确标注为另一概念，hermes adapter 回退路径指向不存在目录的 bug 一并修死。

**M1b Memory：**

- 注入侧改两层：记忆索引行（category+一句话+id）常驻 system，新增 `recall_memory(id|query)` 按需取正文。
  W1 抽出的公共注入函数在此升级，CLI 与 TUI 天然同步。
- `estimated_injection_tokens`（memory-hash.mjs 已有字段）从"估算"变"预算"：索引超限先降置信度最低条目。

**验收**：① 员工在 TUI 聊天中真实触发一次 use_skill，时间轴出现"启动技能"块；
② 记忆 50 条时 system prompt 注入量 < 全文注入的 1/3（真测对比）；③ conformance 加 skills/memory 索引契约用例。

### M2 · 工位驾驶感（todo + plan，对齐 CC 编排体验的轻量子集）

- `todo_write` 工具 + `todo.updated` 事件（additive）：多步任务的计划/进度真值，
  TUI 右栏 TASK QUEUE 从"历史记录"升级为"当前任务的活清单"，时间轴同步打点。
- **plan mode 轻量版**：任务型请求先产出计划清单 → 走既有审批条（approve/revise）→ 执行中逐项勾销。
  不做 CC 的完整 permissionMode 体系，只做"先看计划再放手"这一个用户价值。
- `ask_user` 结构化提问工具（2-4 选项 + 其他），复用 PendingAction 数字键选择——审批条的自然泛化。

**验收**：给员工一个 3 步以上任务，TUI 可见计划审批→逐项进度→完成勾销全过程。

### M3 · Dream 点火与流量（一半是运营动作）

- **点火必须分成两条证据链**：
  1. **自动推荐证明**：累计至少 8 个不同 accepted TaskRun 后，不使用手动按钮，观察
     `dream.recommended` 且 `trigger_reasons` 含 `accepted_tasks`；
  2. **生命周期证明**：冻结 active memory hash → 跑真基线 eval（`mock:false`、provider verified）→
     生成候选 → 跑真 candidate eval（PASS、hash 匹配、分数不回退）→ 人工审批 → **首次 ACTIVE**。
     手动触发会绕过软阈值，只能证明生命周期，不能冒充自动推荐证明。
- `note_memory` 轻采集通道：会话中低门槛记候选（只进未晋升池，绝不直写活跃库——两道门不动），
  解决批量链"没原料"（当前 reflections 仅 1 条）。
- `valid_until` 衰减执行者：dream 策展时过期条目强制进 review；`supersedes` 冲突规则写进 curator prompt
  （新旧矛盾必须显式二选一，不许并存）。
- ACTIVE 后立即使下一次模型调用重建 memory index（epoch/hash 可观察），同时验证认证失效；
  不要求篡改已在飞行中的模型调用。
- legacy 小梦退役计划：批量链点火验证后，`legacy_learning` 默认翻 false 的条件与时间点写死在本文档
  （条件：≥2 名员工完成 dream ACTIVE 且 eval-delta 非负）。

### M4 · 能力供给（把空头支票兑现或撤回）

- `docx_write` 最小实现（一个格式先行，验证管线）；在此之前 **preflight block 文案明示**
  "文档生成能力建设中"而非报错式拒绝。pdf/xlsx/pptx 顺延，不齐不虚标。
- **MCP client 接入**（战略投资）：runtime 起真 MCP 连接，抄 CC 的延迟加载（先载工具名、schema 按需）；
  第一个目标 = code-review-shrimp 的 github MCP（mcp.json 已声明、catalog provider binding 已在）。
  接通后 `configuredProvidersFromEnv` 硬编码空 Set 的历史使命结束，adapter 类能力第一次有真供给。

**验收**：shrimp 在 TUI 里真实调用一次 github MCP 只读工具且经权限网关；`tools/list` 只暴露
allowlist 内的只读工具，写工具缺失或被拒，审计日志落盘且不含 token；员工产出一份真 .docx 落 artifacts。

---

## 3. 依赖与顺序

原始建设依赖为：M0 全部独立；M1a/M1b 同批（同一模式）；M2 依赖 M0-W3；
note_memory 依赖 M1b 的公共注入函数；M4 独立。上述建设项现已大体完成，当前执行顺序由
§6.4 的 Release Candidate 收官链取代，禁止绕过 P1 修复直接做外部点火或发布。

---

## 4. 明确不做（本版，含理由）

- **hooks 体系**：CC 的 hooks 与权限模型是组合关系，需要先有稳定的事件面与配置面；v0.21 候选。
- **subagent/Task 编排**：整层大工程（隔离上下文+独立权限+摘要回传），是数字员工做复杂任务的天花板，
  但不该和接线批混在一个版本；v0.21 主轴候选。
- **compaction**：现有 context-budget 护栏 + M1 索引化省下的注入量，足以撑到下个版本。
- **OS 级 bash 沙箱**：现行 fail-closed 白名单比 CC 的沙箱换自由更保守，员工场景下先不放权。
- **browser_render 启用**：egress 过滤未就绪，维持 fail-closed（v0.19 拍板不变）。
- **完整离职数据工作流**：v0.20 仍保持软删留史并把文案说真；记忆包导出、继任交接、`--purge`
  三个动作已在 §6.3 采纳为产品方向，但不插入本版 Release Candidate 的安全关键路径。
- NotebookEdit、托管市场、Ratatui 之外的第四条渲染路径。

---

## 5. 验收标准（总）

- 完成标准沿用用户拍板：**真功能接进 live 流 + 端到端真跑**；单测绿 ≠ done，orphaned 模块 ≠ done。
- 每里程碑至少一条 conformance/e2e 守卫（M0 每件小事各带回归断言）。
- 诚实性红线复查：本版结束时全仓不得存在"声明了但恒不可用且无明示"的能力
  （M4 的 preflight 文案与 adapter 能力状态是重点复查对象）。
- 关键健康指标：TUI chat 注入记忆条数 >0（W1）；skill.launched 年发射量 >0（M1a）；
  Dream 同时具备自动推荐、真实 candidate eval、ACTIVE 与 rollback 证据（M3）；
  MCP 同时具备正向读取、负向写入拒绝与审计日志（M4）。

---

## 6. 验收补记（2026-07-16 · sol 深度改进批三路审查 + 全套件真跑）

**结论：本 PRD 的 M0/M1/M4 功能主干已由 sol 批实现并接进 live 流，M2/M3 大部分实现；三套件全绿
（Rust 330/0 · runtime 确定性 108/0 · conformance 13/13）；无 orphaned 模块、无诚实性红线违规。
改动未提交，且 M1 的模型实传预算、M4 的 MCP host 权限分类仍需按 §6.2/§7.1 收口，不能把“主干完成”写成“版本完成”。**

### 6.1 里程碑命中实况

- **M0 九件套 9/9 命中**：W1 记忆进 TUI（且直接做成索引化）、W2 diff 着色进 ratatui
  （预渲染文本行走 tool.succeeded.detail，非结构化 hunk——可接受）、W3 参数摘要
  （event-summary.mjs 生成 label）、W4 esc/Ctrl+C 提示+阶段词（思考中/调用工具中）、
  W5 TUI fire（[f]→FireConfirm→真服务 owner-locked）、W6 fire 文案改"record retained"、
  W7 list_files（glob+depth<8+拒 symlink）、W8 hermes semver（VersionReq 真比对，flow_state.rs:550）、
  W9 KPI v1→v2 迁移（migrateKpiV1 + kpi-migrate.mjs，legacy 永不提升）。
- **M1 索引化主干实现**：context-runtime.mjs——skills 索引（1536 字符/条，默认 context window 的 1% 预算）+ use_skill
  按需取正文并真发射 skill.launched；memory 索引（1000 token 预算）+ recall_memory；
  buildIndexedSystem 四路径（CLI/Task/Chat/JSONL）统一消费；conformance [15] 守卫。2026-07-18 已把
  实际模型 `contextTokens` 接入同一 profile 快照；当前 `x-ai/grok-4.5` 按官方 500k 上下文计算 1% 预算，
  未知模型保守回落 200k，profile 可用 `model.context_tokens` 显式覆盖。
- **M2 live 路径已完成（2026-07-19 复核）**：`todo_write` + `todo.updated` + TASK QUEUE、`ask_user`
  PendingAction 与 plan approval 均已进入 JSONL Workbench；三步向量实际覆盖 `plan.created` →
  `approval.required(kind=plan_approval)` → `plan.approved` → 多次 `todo.updated`/step 完成，EOF 期间的待回答问题也能取消退出。
- **M3 代码就绪**：note_memory 轻采集→候选池→assessDream 消费；激活门 fail-closed
  （真基线+真 candidate eval+provider verified+双 hash 匹配+PASS/非回退+人工批准）。
  Dream 激活/回滚后的会话内 context refresh 已接进 live JSONL 路径，下一次模型调用使用重建后的
  memory index，epoch/hash 同时进入事件与 Rust 时间轴；**实际点火仍是运营动作**（磁盘尚无生产 ACTIVE，
  需真 judge key）。
- **M4 功能主干实现**：docx_write（手写 OPC ZIP+CRC32，真 .docx）；mcp-client.mjs 真 stdio MCP
  （tools/list+call+allowlist+审计落盘），shrimp mcp.json 切官方 docker 镜像+GITHUB_READ_ONLY；
  host 侧 MCP 权限信任闭环已由 §6.4.5 修复，当前只缺带最小权限 token 的外部正/负调用证据。
- **额外**：网站侧大规模诚实性纠正——全员虚假 C2 撤回降级（evidence_state 驱动）、已验证评价系统
  （强绑定 accepted TaskRun 回执，422/409 拒伪造）、legacy KPI 显式隔离、本地状态 API 硬化
  （O_NOFOLLOW/nlink/TOCTOU/owner-lock）、Landing v4、生产默认绑 127.0.0.1。

### 6.2 修复清单（审查发现，按优先级）

| 级                     | 问题                                                                                                                                                                                                                                                  | 位置                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P1                     | busy 态 Ctrl+C 只发 cancel 无强退路径——runtime 挂起则驾驶舱键盘无法退出（回退了"Ctrl+C always quits"保证）。修：短窗双击 Ctrl+C 强退                                                                                                                  | mod.rs:1182                                                                          |
| P1                     | MCP"只读"仅信任 mcp.json 作者 allowlist，结构不强制——副作用工具可借 readonly 免确认执行。修：第三方 MCP 工具默认 confirm；仅可信 server + 逐工具显式 `side_effect:false` + host allowlist 三者同时满足才可降为 read。server 的 read-only 只作纵深防御 | mcp-client.mjs:215 / tool-gateway                                                    |
| P2→已修 2026-07-18     | rendering_preview 原会遮蔽其后 token.delta；现区分 provisional/final 缓存，同 part 后续 token 立即撤销 provisional 并回退完整 raw，final 稳定缓存不受影响                                                                                             | state.rs / `rendering_preview_falls_back_to_raw_when_the_same_part_grows`            |
| P2→已修 2026-07-18     | gateway 原把整个 coordinate action 类别并入 readLike；现只允许 `todo_write` / `ask_user` 两个已审查本地控制面工具兼容 readonly，未来 coordinate 工具默认不得继承免确认资格                                                                            | tool-gateway.mjs / tool-gateway.test.mjs                                             |
| P2→已修 2026-07-18     | 工具详情原在 4096 字符处静默截断；现由 canonical helper 保留同一硬上限并追加“原始 N 字符”标记，事件同时带 additive `truncated/detail_original_chars`                                                                                                  | event-summary.mjs / jsonl-bridge.mjs / event-bridge.mjs                              |
| P2→已修 2026-07-18     | TUI fire 原用 `let _` 丢弃 owner-lock/服务失败；现成功与失败均进入既有 hint row，失败保留真实错误且下一次按键自然清除                                                                                                                                 | mod.rs / state.rs / ui.rs                                                            |
| P2→已修 2026-07-18     | 可折叠工具/思考块原已有 Enter/Ctrl+R 行为但无 disclosure；现折叠态显示 `▸`、展开态显示 `▾`，选中行 EVENT DETAIL 明示 Enter 展开/折叠                                                                                                                  | ui.rs / `tool_line_folds_and_expands` / `thinking_block_renders_folded_and_expanded` |
| P3→部分已修 2026-07-19 | `list_files` 只有显式 `**/` 可跨目录；memory 显式 low 排在缺失 confidence 前；包回执短 digest 无越界；Performance 单员工加载失败保留其余真数据；distribution version drift 加自动守卫                                                                 | tools-fs/context-runtime/main.rs/Performance/validator                               |
| P3                     | dream approve→activate 非事务（崩溃停 APPROVED 态，可 inspect 恢复）；`crew` 命令别名需确认随包安装；轮次高亮绝对行号 700ms 内可漂移                                                                                                                  | 各处                                                                                 |

### 6.3 K3 调研采纳修正案（对照外部设计文档裁决后并入）

采纳：A1 审批"学习式授权"（允许且本会话不再询问 <scoped pattern>+放行清单确认）；
A2 Rejected 删除线+Pending `~`+岗位语义动词库（已完成，见 §6.4.17）；A3 **解雇三入口**（导出记忆包迁移继任/交接/彻底删除；
UI 可给三条主路线，但导出与交接可组合，`--purge` 是独立的不可逆阶段；
记忆包=memory-store+hash+provenance 现成基建的薄封装）；
A4 skill frontmatter 扩展（`allowed-tools`/`user-invocable`/`disable-model-invocation`）+技能调用统计回流 KPI
（已完成，见 §6.4.17；字段只收紧技能可见性/工具上限，不成为授权源）；
A5 Dream 策展补件收窄为日期绝对化、外部失效引用清理与晨报卡进 DREAM 屏（已完成，见 §6.4.15）；
过期 `valid_until` 强制复核和 `supersedes` 冲突消解已由当前代码与回归测试实现，不再重复排期；
A6 自治等级产品化叙事（既有权限+信任自动验收的包装，已完成，见 §6.4.16）。
拒绝：L5 bypass（无 OS 沙箱不做）；"基于 hermes 拓展"表述（架构误读，hermes=导出目标）；
市场星级 mock（只显示 verified-review 真值）；HTTP+SSE 重构（stdio JSONL 契约已稳，多客户端时加投影层）。
v0.21 候选池追加：技能自动沉淀（轨迹→SKILL.md+golden 重放+审计门）、面试 golden task 屏、context:fork。

### 6.4 v0.20 Release Candidate 收官计划（唯一发布关键路径）

#### 6.4.1 RC-0 · 仓库安全检查点

2026-07-17 快照：Git 根为 `crewhire/`，分支 `dream-m1-m4`，HEAD `823b49a`；
170 个 tracked 文件变化（+12148/-2894）、59 个 untracked、暂存区为 0。本文档位于 Git 根之外，
不会自动进入 `crewhire` 提交。以上只是风险基线，不是发布证据。

1. 排除 `.tmp_page*.png`、`crewclaw.exe.bak*` 等运行/截图产物；严禁提交 `.env`、token、memory、session、
   log、state DB、workspace 或其他 forbidden paths。
2. 明确本文档归属：复制/迁入 `crewhire/docs/` 作为版本化 canonical PRD，或明确记录为仓库外发布档案；
   不允许默认遗漏。
3. 先建立可恢复的 checkpoint，再修 P1。提交按能独立通过门禁的垂直切片组织；若跨层依赖使切片
   无法独立构建，就诚实做一个 integrated checkpoint，不能为了漂亮历史制造不可运行的中间提交。
4. 每个 staged snapshot 至少跑其覆盖范围的定向测试；最终 RC 仍必须跑 §6.4.4 全门禁。

#### 6.4.2 RC-1 · 两个发布阻断 P1

1. **驾驶舱可逃生**：busy 首次 Esc/Ctrl+C 发送 `generation.cancel`；短窗内第二次 Ctrl+C 必须直接退出，
   即使 Node/runtime 不再回事件也不得永久锁死。补 Rust 状态机测试和挂起子进程真机测试。
2. **MCP 默认不可信**：修复 §6.2 P1；未声明、未知或来自不可信 server 的工具不得以 readonly 名义免确认。
   官方 GitHub MCP 的 `GITHUB_READ_ONLY=1` 与工具 allowlist 保留，但不能替代 host 侧权限判定。

两项完成并重跑相关回归前，禁止执行“首次 MCP 真调用”验收，禁止产出 release build。

#### 6.4.3 RC-2 · 三条真实证据链

**A. Eval / provider：**

1. 先把 `pnpm eval:expert product-prd-crab` 跑通，结果必须 `mock:false`、`provider_status:verified`；
   记录 `worker_model`、`judge_model`、endpoint/provenance、`memory_state_hash` 和原始结果路径。
2. `HERMES_MODEL`、`CREW_EVAL_MODEL`、`ZENMUX_BASE_URL` 任一变化都创建新 baseline lineage，不能把换模型
   伪装成同一基线的普通重试。若当前真实 provider 持续流停顿，可先换 worker/judge 证明管线，
   但 Dream 激活前必须用最终选定组合重跑绑定当前 memory hash 的正式基线。

**B. MCP：**

1. 固定 GitHub MCP 镜像版本或 digest，配置最小权限 token；日志和错误输出不得出现凭据。
2. 保存 `tools/list` 结果，证明仅暴露 shrimp allowlist 中的只读工具；执行一次真实读取并保存
   CrewClaw `crewclaw.mcp-call/v1` 审计记录。
3. 做一次负向探针：写工具必须在列表中缺失，或由 server/host 明确拒绝；只做正向成功截图不算完成。

**C. Dream：**

1. 通过真实日常任务累积至少 8 个不同的 accepted TaskRun/reflection，先取得不带 `manual_trigger` 的
   自动推荐证据；若只想先跑通生命周期，可手动触发，但必须标注为 `manual_trigger`。
2. 冻结 active memory hash 后跑正式 baseline，随即生成候选并跑真实 candidate eval；候选必须 PASS、
   provider verified、candidate hash 匹配且 score 不低于 baseline。
3. 人工审批后进入 ACTIVE；验证认证失效、下一次模型调用使用新的 memory index/hash，并至少在非生产员工上
   做一次 rollback 演练。磁盘出现 ACTIVE 目录本身不足以证明完成。

#### 6.4.4 RC-3 · 发布门禁与部署

以下条件必须全部满足，任何一项缺证据都不得宣告 v0.20 完成：

- Git：工作树干净；无未归档产物/禁入文件；canonical PRD 归属明确；release commit/tag 可追溯。
- 安全与恢复：双击 Ctrl+C 强退可复现；未知 MCP 工具默认 confirm/deny；负向写工具探针通过。
- 自动化：`pnpm run check`、`pnpm run lint`、`pnpm test`、`pnpm run test:runtime`、
  `pnpm run test:conformance`、`pnpm run test:e2e`、`pnpm run validate:all-experts`、
  `cargo test --manifest-path crates/crewclaw-cli/Cargo.toml` 全绿；涉及生成物时追加 `pnpm run schema:generate`
  后无意外 diff。
- 真实运行：eval、MCP、Dream 三条证据链完整；不能用 unit/conformance 代替外部真调用。
- 部署：release exe 重编译并以安全 rename 方式部署；记录 exe hash/version/commit；用该构建完成
  WORKBENCH、TEAM、MARKET、DREAM、EVAL 五屏真机终验，截图只作视觉证据，事件/日志/产物作行为证据。

#### 6.4.5 2026-07-17 · RC-1 代码修复记录

- **busy 强退已实现并进入 live 键盘路径**：第一次 Ctrl+C 发 `generation.cancel`；同一 task session
  在 750ms 内第二次 Ctrl+C 返回本地 Quit，不等待 runtime 回包；Esc/其他键会解除武装，过期或跨任务不会误退。
  新增 2 条回归，Rust 全套由 330 增至 **335/335**。挂起 Node 子进程下的真实双击键盘见证仍待部署后终验。
- **MCP 默认确认已实现**：`mcp_call` 从 L1 自动只读提升为 L3 `external_mcp`；第三方调用默认逐次确认，
  即使通用 L3 policy 配成 allow 也不得降级。live employee profile、session catalog、审批文案同步为
  `requires_authorization` / `per_call`，避免网关与 UI 双脑；GitHub server 的 read-only 继续作第二道防线。
- **本批自动化证据**：`pnpm test`（Vitest 123/123、runtime 108/108、Rust 335/335）、
  conformance 13/13、typecheck、全仓 lint、`validate:all-experts`（5/5）和 `git diff --check` 全绿；
  `pnpm run test:e2e` 通过 vterm 119 帧零消失、dev Chrome 6/6、production Chrome 4/4，且 production
  release build 成功。以上证明代码与自动化门已过，**不等于** GitHub MCP 外部真调用、Dream 点火、
  exe 部署和五屏真机证据已经完成。
- **RC-0 卫生进度**：`.gitignore` 已覆盖 `.tmp_page*.png` 与根目录 `crewclaw.exe.bak*`，现有 4 个
  本地截图/备份二进制不会误入提交；其余 55 个 untracked 是本批源文件/测试，仍需纳入 commit map，
  不能用总量下降冒充已完成提交审计。

#### 6.4.6 2026-07-18 · Dream 会话内索引刷新记录

- **唯一重建入口**：`loadProfile` 用同一个 `refreshContext` 闭包生成初始 prompt 与后续刷新快照；闭包复用
  `buildIndexedSystem`、原 SOUL、技能目录、降级提示和 MCP index，只替换会话的 `system/contextIndex`，
  不重新解析或放宽工具授权。`buildIndexedSystem` 同步返回 canonical `memoryStateHash`。
- **时序语义冻结**：Dream durable activation/rollback 成功后才重建上下文；`buildRunTurn` 在每次调用开始时
  展开 `agentLoopDeps`，所以已在飞行中的模型调用不被篡改，紧随其后的下一次调用读取新快照。
- **additive-only 可观察证据**：`session.ready.context_index` 新增初始 `epoch` 与 `memory_state_hash`；
  `dream.activated` / `dream.rolled_back` 新增 `context_refresh`，包含 `status/epoch/previous_memory_state_hash/
memory_state_hash/context_index`。hash 必须与 activation receipt 匹配才应用；刷新异常不会回滚已经发生的
  durable memory 事实，而是诚实发出 `status:failed` 并保留旧 epoch，禁止冒充“当前会话已变聪明”。
- **双端消费与回归**：Rust Dream 时间轴显示短 hash + epoch；JSONL 完整生命周期测试用真实 controller 状态机
  验证“激活→下一轮看见新记忆→回滚→下一轮撤回”，不是直接调用 helper。当前自动化：`pnpm test`
  （Vitest **123/123**、runtime **108/108**、Rust **336/336**）、conformance **13/13**、typecheck、ESLint、
  Clippy、rustfmt 与 `validate:all-experts` **5/5** 全绿。该 deterministic 回归只证明代码链，不得替代
  §6.4.3 C 的真实 baseline/candidate eval、人工审批、ACTIVE 与 rollback 证据包。
- **模型实传预算同时收口**：`loadProfile` 从同一个 `env/profile` 冻结 model + `contextTokens`，并传入初始与
  Dream 刷新后的 `buildIndexedSystem`；`session.ready.context_index.context_tokens` 可观察，TUI 上下文百分比
  复用同一 resolver。当前默认模型 `x-ai/grok-4.5` 使用 xAI 官方 500k 值（
  https://docs.x.ai/developers/models/grok-4.5 ），技能索引预算为 5,000 token；不改写 gateway 价格估算。
- **coordinate 权限类别已收窄**：readonly 不再信任整个 `action:coordinate`；仅显式白名单中的
  `todo_write` / `ask_user` 放行。新增“未来 `future_delegate` coordinate 默认不兼容 readonly”负向回归，
  runtime **108/108**、conformance **13/13**、lint 与 diff check 复验通过。
- **preview 尾部遮蔽已消除**：Rust reducer 为 `assistant.rendering_preview` 单独记录 provisional 身份；同一
  part 后续 `token.delta` 到达时立即删除旧预排版并回退 conversation 的完整 raw 文本，随后真正的
  `assistant.rendered` 再建立稳定快照。无需猜测超时时间，且 final 快照不会被晚到 token 误删。Rust
  **337/337**、Clippy、rustfmt、vterm **119 帧零消失**全绿。
- **工具详情截断不再静默**：`truncateToolDetail` 成为 JSONL 与进程内 event bridge 的共享入口；长详情仍严格
  封顶 4096 字符，但末尾显式显示原始字符数，协议 additive 附带 `truncated:true` 与
  `detail_original_chars`。event-summary 定向测试、bridge E2E **11/11**、runtime **108/108** 全绿。
- **fire 结果不再吞错**：TUI 删除 `let _ = flow_state::fire_employee(...)`；owner-lock 或服务失败会以红色真实
  文本进入既有 hint row，成功也给出保留历史的真反馈，下一次按键清除。两条定向回归、Rust **339/339**、
  Clippy、rustfmt、conformance **13/13**、ESLint、diff check 与 vterm **119 帧零消失**复验通过。
- **折叠 affordance 收口**：复用既有 `collapsible/expanded` 与“选中行 Enter 切换”路径，工具/思考块头行分别
  显示 `▸/▾`，EVENT DETAIL 底行只在可折叠事件上提示 Enter 展开/折叠；没有新增第二套交互。Rust
  **339/339**、Clippy、rustfmt、diff check 与 vterm **119 帧零消失**复验通过。

#### 6.4.7 2026-07-18 · 外部证据 readiness（未完成，不得冒真）

- `.env.local` 已检测到 ZENMUX key（仅判存在，不读取/记录值），但沙箱内运行
  `pnpm eval:expert product-prd-crab` 因 provider 网络不可达终止；申请放开网络后，安全审查因会把真实
  expert-eval 工作负载发送到未验证外部 provider 而拒绝。没有绕过该审查，也没有把失败重试写成基线。
- 磁盘上存在一份 2026-07-16 的旧 `mock:false` 零分记录，但 worker/judge 同为 `x-ai/grok-4.5`，且缺少
  当前 compact reader 所需的有效绑定；`readEvalResult(...)` 返回 `null`。因此 EVAL/Dream 不得消费它，
  更不得称为 provider-verified 正式 baseline。下一步需要用户在知情后明确批准外发，或在本机受信边界内执行。
- `GITHUB_PERSONAL_ACCESS_TOKEN` 仍缺失，GitHub MCP 真调用未启动；Dream ACTIVE job 为 0，当前只有 **1** 条
  真实 accepted reflection，距 §6.4.3 C 要求的 8 条还差 7 条，禁止用合成任务灌数。这三项继续阻断
  §6.4.3 的真实证据链、release/tag、exe 部署与 v0.21 Start Gate。

#### 6.4.8 2026-07-18 · hire 默认真执行诚实性收口

- `crew hire <expert>` 现默认进入真实 Hermes 安装路径；舞台剧本只有显式 `--demo` 才可进入，`--live` 保留为
  向后兼容别名。`--demo --live` 冲突直接报错，显式 demo 缺少 ceremony card 时也 fail-closed，不得偷偷切回
  真实安装。
- CLI help、`hire_demo.rs` 模块契约及三份舞台执行文档均同步；脚本演示命令改为
  `crew hire macao-networking-agent --demo`，普通产品文档中的无 flag 命令继续表示真实雇佣。
- 新增纯分流回归锁定默认 live/显式 demo/冲突拒绝；Rust **340/340**、Clippy、rustfmt 与 diff check 全绿。
  本轮未实际运行 live hire，避免在未获授权时改变 Hermes profile 与 team roster；真机安装仍归部署终验。
- **quarantine 死设施已清理**：全仓确认 `.crewclaw/eval/quarantine` 没有任何生产或测试读写入口，目录只含一份
  已被 compact reader 拒绝的 2026-07-17 provider-failure 手工快照且受 `.gitignore` 排除；已删除该 ignored
  目录。没有把自动迁移塞进 `readEvalResult`，避免只读投影暗中改盘。

#### 6.4.9 2026-07-18 · 认证来源标注收口

- **C1 不再冒充正式认证**：网站卡片/详情页、CLI `list/inspect` 与 Rust MARKET 统一从
  `evidence_state` 派生展示。当前 C1 明示为 `Package validated · registry` / `C1 · 包合同已验证（registry）`；
  只有 `lab_status:certified` 且同时存在 `mock:false + signature + source` 的 registry credential 才可显示
  `Lab certified`。本地 registry 即使手改裸 `C2`，缺签名凭证也会 fail-closed 为“状态已标记、凭证缺失”。
- **发布状态与证据状态解耦**：创作者后台的普通审核通过改称 `Published`，不再叫 `Verified Employee`；Landing
  的 `Certified Expert Crew` 改为 `Validated Expert Packages`。脚本 `--demo` 徽章中的等级改为
  `DEMO · <level> SCENARIO CLAIM`，防止舞台数据被误读为真实凭证。
- **架构文案同步纠偏**：FAQ 不再宣称 Hermes 是 CrewClaw runtime；明确核心引擎为 `packages/runtime`，
  Hermes 是导出/集成目标，与 §6.3 的已拍板边界一致。
- **证据**：新网站 fail-closed 测试与 registry 投影测试 **11/11**，TypeScript check、全仓 ESLint、runtime
  **108/108**、conformance **13/13**、Rust **341/341**、Clippy 与 `git diff --check` 全绿；重建 debug CLI 后
  `list/inspect ai-adoption-whale` 真输出 `C1 · package contract validated (registry)`；生产 Web build 成功、
  vterm **119 帧零消失**、`validate:all-experts` **5/5**。浏览器视觉回归尚未在本轮擅自启动，仍归
  §6.4.4 的授权终验，不得拿逻辑测试冒充像素验收。

#### 6.4.10 2026-07-18 · 工具事件 canonical presenter 收口

- **工具摘要双脑已消灭**：`ui-tools.mjs` 现为唯一工具语义 presenter，统一生成原始 `name`、紧凑
  `args_summary`、终态 `result_summary`、稳定 `label` 与兼容 `action/summary`。`toolLine` 复用同一组函数；
  `event-summary.mjs` 只保留 4096 字符详情截断，并从 canonical presenter 兼容性转出旧摘要 API，不再维护
  第二套工具类型分支。
- **结构化字段从事件源进入 live 流**：`run.mjs` 在每个 requested/running/terminal lifecycle 的源头调用一次
  presenter；`jsonl-bridge.mjs` 与 `event-bridge.mjs` 的正常路径只复制
  `name/args_summary/result_summary/truncated/debug_ref`，仅旧 `onInvocation` 兼容入口调用同一 presenter 补字段。
  Node/Rust reducer 优先消费 `result_summary`，并能用 `name + args_summary` 做无语义拼接回退；旧 v1
  `tool/label/summary` 事件继续有效。
- **`debug_ref` 不造假**：协议允许且校验该可选字段，桥接层会透传；当前 debug 流没有可寻址注册表，因此 runtime
  不生成虚构引用。待真实 debug artifact/索引存在后再发。`truncated` 继续由真实 4096 详情截断结果产生。
- **证据**：新增 presenter 同源性、live agentLoop、JSONL 透传、Node/Rust reducer 与双端协议类型回归；runtime
  **108/108**、conformance **13/13**、Rust **343/343**、Clippy、rustfmt、TypeScript、全仓 ESLint、Prettier、
  `git diff --check` 全绿，vterm **119 帧零消失**。本批不含浏览器像素验收，也未执行外部 MCP/eval、commit 或部署。

#### 6.4.11 2026-07-19 · Doctor/run readiness 单源收口

- **主路径边界已查清**：`crew doctor` 与 live run 原本都通过同一个 `loadProfile()` 消费 ToolCatalog、工作区授权、
  MCP 配置与 provider health；残余双脑来自 run/route 再次直接调用 `pickBackend()`，以及
  `onboardingDoctor` 允许 ambient env 被误作 adapter provider。此次没有重写架构，而是删除这三条旁路。
- **两种 canonical 投影成为唯一证据模型**：`runtimeToolReadiness(toolResolution, runtimeTool)` 只读冻结的
  `sessionCatalog`，统一输出 `ready/availability/code/reason/provider/capabilities`；
  `mcpReadiness(parsedMcp)` 只从已解析 server 的 `ready + missing_env` 投影
  `not_configured/blocked/ready`、可执行 provider 与脱敏 server 列表。环境变量单独存在不能再凭空生成 MCP 能力。
- **run、route、doctor 同源消费**：正式 task 的 research preflight 改读冻结 resolver；TUI route 改用 resolver
  本身也使用的 `searchProviderHealth`，不再把 DDG fallback 当 readiness；`tool-doctor-cli` 同时输出 chat/task 的
  search/render 投影和 MCP server 缺失项，Rust `crew doctor` 只渲染该 JSON，不另算一遍。MCP 仍是可选能力，
  缺失会显式展示但不会无条件拖垮不依赖它的员工；真实 `mcp_call` 继续保持 `P1 + per_call + always confirm`。
- **回归证据**：新增 MCP blocked/ready 脱敏投影、runtime tool alias/intrinsic 投影、ambient credential 负向门禁、
  parsed MCP 正向门禁及真实 tool-doctor CLI 快照测试；研究无 key 的 E2E 继续诚实降级。runtime **108/108**、
  conformance **13/13**、Rust **343/343**、Clippy、rustfmt、TypeScript、全仓 ESLint、触及文件 Prettier 与
  `git diff --check` 全绿，vterm **119 帧零消失**。仓库级 `prettier --check .` 仍只报告本批未触碰的
  `docs/demo-segment.md`，未擅自改写；外部 MCP 真调用、eval、commit、部署与浏览器终验均未执行。

#### 6.4.12 2026-07-19 · 技能 outcome/KPI 归因与 Dream 复核信号

- **调用数与结果归因不再混为一谈**：既有 `.crewclaw/skill-usage` 继续只记录 `use_skill` 成功加载次数，作为 1%
  索引预算的降级排序输入；KPI v2 outcome 新增 additive `skill_usage[{skill_id,calls}]`，在 TaskRun 结算时冻结，
  聚合为调用数、观察任务、正式结算、成功、显式/策略验收、负向结果、成功率与验收率。字段有安全 id、正整数、
  去重、100 项上限和稳定排序校验；旧 KPI v2 outcome 没有该字段仍按空数组读取。
- **归因绑定真实验收事务**：Workbench JSONL 每轮从真实 `skill.launched` 累积同一技能的调用数；产生交付物时把
  快照写入 durable pending-approval 回执，接受/拒绝后才随同一 task settlement 进入 KPI。崩溃恢复继续从回执
  重放，`task_run_id` 幂等键防止重复计数；预检阻塞和无技能任务只写空归因，不会把“安装了技能”冒充“用过技能”。
- **Dream 只给复核信号，不自动删技能**：`assessDreamFromWorkspace` 从同一 KPI 聚合读取
  `skill_retirement_candidates`。门槛为至少 **3** 个正式结算、显式/策略验收均为 **0**、成功率低于 **50%**；
  assessment/TaskEvent 以 additive `skill_signals{advisory_only:true,...}` 暴露，Reflect v1 与 Dream job v1 冻结合同
  均未改动，也不会修改或删除 `SKILL.md`。自动沉淀/淘汰仍属于 v0.21 的受审计工作流。
- **证据与边界**：新增 KPI 正负归因/非法输入、Dream 直接与 workspace 消费、pending receipt→accept→KPI
  端到端回归；runtime **108/108**、conformance **13/13**、Rust **343/343**、Clippy、rustfmt、TypeScript、
  全仓 ESLint、触及文件 Prettier 与 `git diff --check` 全绿，vterm **119 帧零消失**。本项覆盖 v0.20 默认
  Workbench 结算链；显式 legacy `--plain/--task` 本来就不写这份 Workbench KPI，未在本批暗中扩张其语义。
  外部 MCP/eval、commit、部署与浏览器终验仍未执行。

#### 6.4.13 2026-07-19 · A1 学习式授权（会话 permission lease）

- **三选一已经进入真实审批链**：工具授权 `approval.required` 以 additive `choices` 与 `session_lease` 下发；
  Rust Workbench 在存在安全 proposal 时显示 `[a] 仅本次 / [s] 本会话 / [r] 驳回`，宽屏审批条和窄屏模态都明确列出
  `tool · scoped pattern` 放行清单。协议新增 `allow_session` 决策，Node/Rust reducer 都按同一 approval id、kind、
  taskRunId 相关性结算；旧前端仍可继续只发送一次批准或拒绝。
- **lease 不成为第二套权限源**：Permission Gateway 仍先完成平台 deny、工作区 canonical containment、员工声明、
  `necessity/permission/approval` 与 L0-L4 分类；只有最终仍为 `confirm` 的 `L1/L2 + workspace +
tool_authorization` 才能生成 proposal。首版白名单仅含 `read_file/list_files/write_file/edit_file`，并绑定同一工具；
  文件路径只扩到当前父目录（`docs/spec/a.md -> write_file · docs/spec/**`），仓库根文件只生成精确文件规则，
  根目录、通配输入、越界路径、计划审批、shell、MCP、外发和 L3/L4 均不得生成 lease。
- **仅内存、可撤销、全程可审计**：lease 只保存在当前 `jsonl-bridge` 进程内存，不写 `team.json`、员工包或
  `permissions_granted`。`/permissions` 展示当前放行清单，`/permissions clear`（或 `revoke`）立即撤销全部会话
  lease；进程结束自然失效。后续命中仍发出成对 `approval.required + approval.resolved`，并标记
  `auto:true / decision_source:session_permission_lease`；Node/Rust reducer 对该受信自动结算不弹审批框、不暂停 busy、
  不生成“等待批准”通知，但审计事件仍完整保留，不会把免重复点击变成不可追踪的静默执行。
  `allow_session` 若被发给无 proposal 的工具授权会保持 pending；若被发给交付验收也不会被当成接受。
- **证据**：新增 lease 纯函数边界测试与 JSONL 端到端测试，覆盖首次会话授权、同目录自动命中、审计事件对、
  `/permissions clear` 后重新询问，以及 MCP/越界/根目录/跨工具/计划审批负例；Rust 新增协议、reducer、宽窄屏
  放行清单测试。runtime **109/109**、conformance **13/13**、Rust **345/345**、Clippy、rustfmt、TypeScript、
  全仓 ESLint、触及文件 Prettier、`git diff --check` 与 vterm **119 帧零消失**全绿。外部 MCP/eval、commit、
  exe 部署与浏览器真机终验仍未执行。

#### 6.4.14 2026-07-19 · A3 解雇三选一（共享 offboarding 纵切已完成）

- **合同与单一执行主干已经落地**：新增 `crewclaw.memory-pack/v1` 与 `crewclaw.offboarding/v1` Zod/JSON Schema，memory
  pack 绑定 `employee_id + workspace_employee_id + memory_state_hash + source_sha256 + content_hash`；receipt 逐阶段记录
  export/handoff/fire/purge、`permissions_active:false`、保留的审计范围和 `billing:not_applicable`。合同额外校验 request、
  status、payload 与 outcome 不能互相矛盾。`packages/runtime/offboarding.mjs` 成为唯一生产 fire 写入口；旧 Rust 直接
  `fire_active_employee` 仅保留为 `cfg(test)` 参考函数，网站 TypeScript 的重复 fire mutation 已删除。
- **事务边界按审计结论实现**：先写 prepared intent，再按所选策略生成 checksum-bound memory pack 与 handoff draft；
  prepare 任一步失败只写 failure record，roster 保持 active。准备完成后重新在 canonical `.team.json.lock` 下校验同一个
  `workspace_employee_id`，再原子写 `fired + fired_at`；若并发 rehire/换岗导致 employment 改变则拒绝 fire。fire 后
  activity 失败不再伪装成“完全没解雇”，而是生成 `outcome:partial` 的真实回执与 warning。
- **三种产品选择已经接到真实入口**：Rust CLI 支持 `--export-memory / --handoff / --purge`（默认最安全的导出记忆包），
  TUI `[f]` 弹层用 `1/e、2/h、3/p` 选择同三项；网站 Team 页用三项单选，handoff 成功后跳 Marketplace，并把离职员工
  岗位标题预填进 successor 搜索。handoff 内部始终先导出 memory pack、再生成 draft，不自动雇佣；所有入口最终都
  消费同一 Node 服务及同一 receipt，不再各写一套 `team.json`。
- **purge 保持 fail-closed 与诚实口径**：在 team owner lock 内再次确认该员工无 active 记录且目标 employment 已 fired，
  然后清 active memory、memory candidates、Dream 与 skill usage；team/activity/TaskRun/ProofPack/KPI/eval 仍作为组织
  审计账本保留。删除器拒绝 symlink、hardlink、special entry 与未决 `.lock`；部分 scope 已删而后续 scope 被拒时，receipt
  会准确列出已删除 scope 并标记 `partial/failed`。UI 与 receipt 均明确 `media_sanitization:not_performed`；本地逻辑删除
  不冒充 NIST SP 800-88 意义上的存储介质清理，也不伪造停计费动作。
- **跨进程锁已真正统一**：runtime 新锁 owner 使用 Rust/网站可读的 `created_at_ms`，offboarding 与 activity 显式复用
  `.team.json.lock / .activity.json.lock`，避免“服务共享但 owner lock 仍双脑”。新增 guarded file/tree delete，所有路径
  继续受 workspace containment、no-follow、single-link 与 identity recheck 保护。
- **证据**：新增合同矛盾向量、正常导出、handoff、prepare 失败不改 roster、四 scope purge、hardlink fail-closed 与网站
  receipt 消费测试。Vitest **128/128**、runtime **110/110**、Rust **345/345**、conformance **13/13**、Clippy、
  TypeScript、ESLint、schema drift、Web 生产构建全绿，vterm **119 帧零消失**。尚未执行 commit、exe 部署或浏览器真机
  视觉终验；外部 MCP/eval 也仍受既有环境闸门约束。

#### 6.4.15 2026-07-19 · A5 Dream 巩固补件与晨报真值投影（已完成）

- **日期绝对化成为生成门禁，不只是一句 prompt**：curator input 新增 `curation_time_utc` 与
  `absolute_datetime_required:true`，系统提示明确禁止“今天/明天/下周/next week”等相对日期；controller 对新增 memory
  text 做中英相对日期拒绝，并要求 `valid_until` 是带 `Z` 的 RFC 3339 UTC 时间戳。无时区日期和相对日期都会让整个
  candidate fail-closed，不会进入 staged memory。格式选择遵循 RFC Editor 的互联网时间戳规范：
  https://www.rfc-editor.org/rfc/rfc3339 。
- **失效引用清理使用全量 reflection pool 判定**：每次生成前用全部可读 reflection 建立 `task_id -> evidence_ids` 索引，
  active memory 若引用已不存在的 task、无 source task 却带 evidence，或 evidence 不属于所列 source task，就进入
  `invalid_reference_memory_keys` 与强制 review 集合。curator 必须 `drop/replace/merge`，用 `keep` 掩盖悬空 provenance 会被
  controller 拒绝；替换后的新条目仍只能引用本批受信 task/evidence。既有过期 `valid_until` 与 supersedes 双边冲突硬门禁
  保持原样，没有另起一套冲突规则。
- **晨报只投影持久化产物**：Dream job additive 保存当次 `skill_signals` 与 curator summary；
  `buildDreamMorningReport` 从最新 substantive job 的 job/diff/validation/approval 真值计算复核、新增、合并、替换、清理、
  被消解 memory key、validation blocker 与技能淘汰预警数量，不制造“自动沉淀技能”或虚构分数。新增 additive
  `dream.morning_report` 事件，只有客户端协商 `dream/v1` 后才发送；ACTIVE、ROLLED_BACK 及进程重启后均可从磁盘恢复，
  不写入任务时间轴。
- **DREAM 屏与会话隔离一起补齐**：Rust 使用独立 morning projection 渲染晨报卡，宽屏展示 Eval/审批/激活和统计，矮屏
  保留状态与核心计数；无 substantive Dream 时明确显示“无已持久化 Dream 产物”。`session.ready` 会清空上一会话的
  candidate 与 morning thread-local 投影，避免切换员工或重启 Workbench 后串数据。
- **证据**：新增相对日期、非 UTC `valid_until`、悬空 provenance 禁止 keep/允许 replace、ACTIVE/ROLLED_BACK、桥接进程
  重启恢复、Node/Rust 协议镜像、会话清空与宽窄屏渲染向量。Vitest **128/128**、runtime **110/110**、Rust
  **348/348**、conformance **13/13**、Clippy、rustfmt、TypeScript、ESLint 与 vterm **119 帧零消失**全绿。该批没有执行
  Dream 外部真点火、commit、exe 部署或浏览器真机视觉终验；这些仍属于阶段 0 的运营/发布动作。

#### 6.4.16 2026-07-19 · A6 自治成长档位真值投影（已完成）

- **只做产品叙事，不创建第二套授权源**：三档由既有 KPI 真值确定——人工 `accepted < 3` 为“见习”；人工
  `accepted >= 3` 且策略来源 `auto_accepted < 3` 为“转正”；策略来源 `auto_accepted >= 3` 为“资深”。人工验收与
  policy-provenance 自动验收继续分栏，Rust 累计 KPI 补读 `auto_accepted`，并校验二者之和不得超过任务数。该投影不写
  permission preference、不发 tool grant、不改变 Gateway、deny/confirm/allow 或 P0–P4；“成长”只解释既有信任自动机制。
- **TUI 两处消费同一纯投影**：EMPLOYEE 栏显示“成长 见习/转正/资深”与人工或策略验收进度，下一行明确
  “权限 P0–P4 · 逐项授权”；MARKET PROFILE 对每个员工使用本地 `.crewclaw/kpi/<name>.json` 的真实累计值显示同一档位。
  无历史员工同时保留“尚无历史（新员工）”和“见习”，不把起点伪装成已考核状态。24×30 窄栏实际帧已验证成长、权限、
  MEMORY 与 STATUS 可同时完整显示。
- **公开网站只陈述可证明的起点**：registry 静态卡片没有用户本地 KPI，因此统一显示
  `Growth start · Apprentice`，tooltip 说明三次明确人工验收只解锁 trust-auto eligibility，工具权限仍归 P0–P4；网站不声称
  某个公开员工当前已“转正/资深”，也不从认证或星级反推自治级别。
- **证据**：新增三档阈值、manual/auto 分栏、session.ready/磁盘 KPI 解析、EMPLOYEE 宽窄栏和 MARKET 有历史/零历史回归。
  Rust **349/349**、Vitest **128/128**、runtime **110/110**、conformance **13/13**、Clippy、rustfmt、TypeScript、ESLint
  与 vterm **119 帧零消失**全绿。该批没有改权限策略，也没有执行 commit、exe 部署、浏览器真机视觉终验或外部运营动作。

#### 6.4.17 2026-07-19 · A2 状态语义 + A4 Skill frontmatter 闭环（已完成）

- **A2 用符号与语言补足状态，不靠颜色猜语义**：Pending/Waiting 的稳定符号由 `?` 改为 `~`；Rejected 的时间轴标签
  与任务队列标题使用删除线，Failed 继续保持普通失败样式，两者不再视觉同义。生成阶段词由通用“生成中/思考中/调用工具中”
  改为真实事件驱动的岗位语义：理解需求、梳理思路、查阅资料、起草交付物、核对结果、协调任务、起草答复；未知工具明确回退
  “正在使用工具”，不根据时间或随机数伪造工作阶段。
- **A4 frontmatter 进入真实调用链**：skills catalog 严格解析 `allowed-tools` 的官方字符串或 YAML list 形态，以及严格布尔
  `user-invocable`、`disable-model-invocation`。`disable-model-invocation: true` 的技能不会进入模型 1% 索引，模型直接
  `use_skill` 也 fail-closed；`user-invocable: false` 只从 slash catalog 隐藏，不妨碍模型在允许时按需发现。用户显式
  `/<skill> [args]` 会把完整 SKILL.md 注入当前 turn，发射 `skill.launched{source:"user"}`，继续进入既有 KPI、预算排序与
  Dream 淘汰复核闭环。
- **`allowed-tools` 只会收紧，永远不会授权**：激活技能声明工具边界后，多个活动技能按声明工具并集形成当前 turn 的额外上限；
  未声明工具在 executor 前被拒绝，`use_skill` 保留用于技能组合。即使声明命中，也必须继续通过现有 Gateway 与 P0–P4 的
  deny/confirm/allow；它不会创建 preapproval、permission lease 或第二套 grant。该语义有意比 Claude Code 当前把
  `allowed-tools` 描述为可免确认工具更保守，同时保持与 Agent Skills frontmatter 字段兼容：
  [Claude Code skills](https://code.claude.com/docs/en/slash-commands)、
  [Agent Skills specification](https://openagentskills.dev/docs/specification)。
- **live-path 证据**：`session.ready.caps.commands` 真包含可由用户调用的 skill slash、隐藏后台 skill；slash 进入模型 turn 时携带
  `initialSkillIds`，正文真注入并发事件；未声明 `artifact_write` 在 executor 前被 skill boundary 拦截；模型加载 manual-only
  skill 被拒。Rust **350/350**、Vitest **128/128**、runtime **110/110**、conformance **13/13**、Clippy、rustfmt、
  TypeScript、ESLint 与 vterm **119 帧零消失**全绿。该批没有执行 commit、exe 部署、浏览器真机视觉终验或外部运营动作。

#### 6.4.18 2026-07-19 · RC 完成度逐项复核（当前权威状态）

- **RC-0 的 PRD 归属已解决，Git 收口仍未完成**：本文件已同步进入 `crewhire/docs/prd_v0.20.md` 作为版本化
  canonical source；外层镜像与仓内文件均为 671 行，本次审计的规范化逐字节比较通过。文档 hash 不在正文中自引用，
  release 时写入独立 evidence manifest。当前分支/HEAD 仍为
  `dream-m1-m4@823b49a`，工作树有 **190 tracked changed + 67 untracked**、staged=0；禁入路径扫描为 0，
  `.gitignore` 已覆盖 `.crewclaw/.env/log/db/tmp_page/exe.bak`。因此“不会漏 PRD”已证，但 clean tree、release commit/tag 尚未证。
- **M1/M2/M4 本地证据补齐**：conformance [15] 与 context-runtime 回归均真实构造 50 条 memory，断言索引估算
  `< fullEstimatedTokens/3` 且正文不进 system；M2 JSONL 回归覆盖计划审批、逐项 todo/step 与 `ask_user`；项目 artifacts
  已有 2 份 `.docx`，两者均含 OPC 必需的 `[Content_Types].xml`、`_rels/.rels`、`word/document.xml`。docx 结构与 live
  artifact 已证，但正式 release evidence receipt 仍需随外部证据包归档。
- **当前自动门状态**：Rust **352/352**、Vitest **130/130**、runtime **110/110**、conformance **13/13**、
  expert validator **5/5**、生成 schema/data **17 文件无漂移**，TypeScript、ESLint、Clippy、rustfmt 与 vterm
  **119 帧零消失**全绿。当前代码的 Web production bundle 与 Rust release build 已通过；
  `test:e2e:dev/production` 浏览器自动化及部署五屏未在无授权情况下启动，不能由上述本地门替代。
- **候选二进制现在具备可记录版本**：修复顶层 `--version/-V/version` 原误入交互 hire 菜单的问题，
  release exe 真输出 `crewclaw-cli 0.1.0`；当前候选文件 7,478,675 字节，SHA-256
  `3D035F394162C847C41B47342210484A0438FF4B0370646F097D57562E456FF8`。该构建绑定的 Git HEAD 仍是
  `823b49a` 且工作树 dirty，只能证明当前源码可构建，不能作为最终部署 hash；正式 hash 必须在 release commit 后重建。
- **外部证据仍为硬缺口**：项目状态根中 dream=0、memory=0、eval=0、MCP audit=0，reflections 仍仅 **1** 条；
  用户主目录不存在另一份 `.crewclaw`。当前进程的 GitHub、ZENMUX、Anthropic、OpenAI 相关凭据/模型环境变量全部缺失，
  因而不能诚实执行 provider-verified eval、GitHub MCP 正/负探针或 Dream baseline/candidate/ACTIVE/rollback。v0.20 仍是
  **代码 RC 已通过、本地发布准备未完成、真实运行与发布未完成**；不得标成 release，也不得开启 v0.21。

#### 6.4.19 2026-07-19 · P3 小型可靠性维护切片（已完成）

- **globstar 不再隐式越目录**：`**/` 是唯一跨目录语义；`**.md` 只匹配当前相对路径段，普通 `*.md + recursive`
  继续按 basename 匹配以保持兼容。回归同时断言两种行为。
- **记忆降级排序说真**：显式 `low` 现在仍高于完全缺失/未知 confidence；缺失值不再伪装成 medium，未知枚举也统一
  fail-soft 到最低档，不会挤掉有明确置信度的索引项。
- **Performance 改为部分成功聚合**：共享 `loadSettledRecords` 使用 `Promise.allSettled`，单个员工接口失败时保留其余员工
  KPI，并在页面明示失败员工数量与 id；空团队返回诚实空集。直接回归 **2/2**。
- **两个发布守卫补实**：Rust 包回执用边界安全的短 digest，短串/非 ASCII 不 panic；validator 对
  `distribution.yaml ↔ hire.yaml` 版本漂移增加显式红测。全量结果：Vitest **130/130**、Rust **352/352**、runtime
  **110/110**、conformance **13/13**、validator **5/5**、schema/data **17 文件无漂移**、Clippy/TypeScript/ESLint、
  vterm **119 帧零消失**与 Web/Rust production build 全绿。

---

## 7. v0.20 发布后修复批与产品化队列（不阻塞 RC，除非触发诚实性红线）

### 7.1 P1 修复批

- **诚实性已收口并前移到 RC**：`crew hire` 默认 live、仅显式 `--demo` 走剧本、quarantine 死目录清理、
  认证徽标 registry 来源标注与普通发布状态去 `Verified` 化均已完成；C1 现在只表达包合同验证，正式实验室认证
  必须绑定签名 `mock:false` credential。后续若再次出现裸等级冒充认证，立即升级为 RC blocker。
- **双脑消灭（工具摘要已完成）**：TaskEvent additive 已接入结构化
  `name/args_summary/result_summary/truncated/debug_ref`；runtime canonical presenter 是唯一工具摘要实现，
  `ui-tools.mjs` 与 `event-summary.mjs` 不再各自推导语义。`debug_ref` 在没有真实可寻址对象时保持缺省，禁止伪造。
- **双脑消灭（readiness 已完成）**：doctor、正式 run 与 TUI route 已共享冻结 ToolCatalog resolution、
  `runtimeToolReadiness`、`mcpReadiness` 与 `searchProviderHealth`；ambient env 不再创建 adapter 能力，Doctor 只渲染
  canonical JSON 投影。后续若新增 provider，必须先进入 parser/resolver，再由同一投影暴露，不得恢复旁路探测。
- **索引化补完已完成**：真实模型 `contextTokens`、Dream 会话内索引刷新、技能调用次数驱动 1% 预算排序，
  以及 accepted/rejected outcome 的 KPI 技能归因均已接入默认 Workbench live 流；Dream 已消费带最小样本门槛的
  advisory 淘汰复核信号。自动删除/重写技能不属于 v0.20，仍需等待 v0.21 的生成、golden 重放与审计门。
- **TUI 小改已收口**：detail 4096 截断显式标记、折叠块 `▸/▾` + Enter 提示、fire 失败真反馈、
  `rendering_preview` 尾部回退与 `coordinate` readLike 白名单收窄均已完成并前移到 RC 收口记录。

### 7.2 K3 采纳件与设计排队件

- **A1 学习式授权已完成**：实现为会话级、可撤销 permission lease，确认时展示 scoped pattern 放行清单；
  仅在既有 Gateway 返回 confirm 后生效，不落盘、不越过 deny，详见 §6.4.13。
- **A2 状态语义已完成**：Pending 使用 `~`，Rejected 删除线与 Failed 分离，busy 阶段词由真实 generation/tool 事件投影为
  岗位语义动词，详见 §6.4.17。
- **A4 Skill frontmatter 已完成**：模型/用户可见性三态、slash 显式调用、完整正文按需注入与技能 KPI 回流进入 live 流；
  `allowed-tools` 只构成额外上限且仍经过 Gateway/P0–P4，不授予权限，详见 §6.4.17。
- **A6 自治等级产品化已完成**：见习→转正→资深只投影人工/策略验收 KPI，TUI 使用本地真累计，公开 registry
  只声明成长起点；不成为第二套授权源，详见 §6.4.16。
- **A3 解雇三选一已完成**：共享 offboarding 服务按 `prepare -> fire -> optional purge` 执行；handoff 自动包含记忆导出，
  CLI/TUI/网站共同消费 checksum-bound receipt。`--purge` 只做应用状态逻辑删除并保留审计，详见 §6.4.14。
- **A5 Dream 补件已完成**：日期绝对化、失效 task/evidence 引用强制清理及 restart-safe DREAM 晨报卡已进入 live
  `dream/v1` 流；过期/冲突/激活两道门没有放松，详见 §6.4.15。
- EVAL 趋势、REPUTATION、MARKET COMPAT、TASK QUEUE 成本等视觉件，必须等真实数据填充后的五屏终验再定版。
- **维护项已完成**：distribution 版本守卫与 Performance `allSettled` 已进入 §6.4.19。
- **其余维护项**：memory-harness 绕过通道、内建工具 catalog、fired 记录治理、`crew` 命令别名，分别进入可验证的
  小批次，不与新架构混交。

### 7.3 流式渲染专项（架构指标，不再靠调参反复修改）

已查实的两个根因保留为专项输入：`jsonl-bridge.mjs` 只在工具边界/生成结束的
`flushAssistantPart` 做最终 typeset；`reveal-pacer.mjs` 以固定 30ms × 2–4 grapheme 播放正文，
而 thinking 直接 emit。由此必然产生正文无界追播、thinking/正文错位以及“任务结束后才定妆”。
Rust 侧又按用户轮复用单一 thinking block，导致工具后的新思考被追加回时间轴顶部旧块。

实施顺序：

1. pacer 改为追赶式合帧：每 30ms 发出该帧已到达的全部增量，积压超过阈值（初值 500 grapheme）
   直接放行；thinking.delta 与 token.delta 进入同一有序合帧通道。
2. `tool.requested` 到达时结束并折叠当前 thinking block，下一个 thinking.delta 在工具行之后新建块，
   按模型调用而非用户轮分块。
3. typeset 改成稳定块增量定妆：段落/标题/列表/代码围栏闭合后成为不可变快照，仅当前开放块重排；
   移除“裸文本流式 + 末尾整段替换”的双形态。
4. raw JSON 只进 debug；todo/artifact 等 detail 走结构化摘要；重复 plan/step/todo 事件合并为工具行 +
   TASK QUEUE 真值。生成活跃期默认贴底，仅 PgUp 显式脱离，Esc/G 回到底部。

专项封版只看三条硬指标：模型最后一字到达至屏幕显示完毕 ≤300ms；同一文本全程只有一种渲染形态、
无末尾替换 diff；thinking/tool/answer 严格按事件发生序。指标写进 conformance 后冻结策略，
不再回到“定速播放 vs 实时”“裸流 vs 定妆”两组旋钮上。

---

## 8. v0.21 启动闸门与唯一大工程

### 8.1 Start Gate

v0.21 只有在以下条件全部成立后启动：

1. v0.20 已有 release tag、已部署 exe hash，且无开放 P0/P1；
2. 真实 eval/MCP/Dream 证据包可复查，Dream 至少完成一次 ACTIVE + rollback 演练；
3. TaskEvent 仍满足 additive-only，task/turn/tool/approval/Dream 的 lineage 与取消语义已冻结；
4. v0.20 发布后的监控没有暴露新的诚实性、安全性或恢复性阻断问题。

### 8.2 范围冻结

v0.21 只承诺一个大工程：**subagent/Task 编排 MVP**。开工前先写并通过小型 RFC，至少冻结：

- 父子 task/turn lineage、隔离上下文与结果摘要回传；
- 权限继承只能收紧、审批归属、预算/并发上限；
- cancel/timeout/error 的父子传播与审计；
- 与未来 hooks 兼容的生命周期事件，不在本版同时实现完整 hooks 平台。

Compaction 从候选池末尾前移到 subagent MVP 紧邻项：子任务长上下文和摘要回传验证后再决定是同版最小实现
还是 v0.21.x；技能自动沉淀、完整 hooks、面试 golden task 屏继续排队，不能与 subagent 同时扩成三个大工程。

### 8.3 外部安全依据（2026-07-17 复核）

- [GitHub MCP Server 官方配置](https://github.com/github/github-mcp-server/blob/main/docs/server-configuration.md)：
  `GITHUB_READ_ONLY`/`--read-only` 会优先过滤写工具，但这是 server 侧纵深防御。
- MCP Tools 规范 2025-11-25（latest）：客户端必须把 tool annotations 视为不可信，并负责敏感操作确认、
  输入展示、结果校验、超时与审计：
  [官方规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。
