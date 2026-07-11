# CrewClaw v0.18 — 从 Agent Demo 到 AI 员工平台：员工标准 + 真评测 + 真分发

依据：2026-07-09 全产品面真/假审计 + 2026-07-10 高维复盘。战略转向由用户裁定。
一句话定位：**OpenCode 让 AI 会工作，OpenWork 给 AI 一台电脑，CrewClaw 证明哪个 AI 员工值得被雇佣。**
护城河 = 员工规格（什么是数字员工）× 评测（真分数）× 声誉。本版把前两块从"壳"做成"真"。

---

## 0. 边界宪章（2026-07-10 用户拍板，后续所有 Feature 以此裁决）

- **CrewClaw TUI = 监督驾驶舱**，不是全能工位。职责只有三件：**观察 / 控制 / 验收**。
  - 已建成的功能不回炉；未建的功能**只允许"简单预览/查看"级别**。
  - 据此永久裁掉：Artifact 的 `e` 外部编辑器（编辑=执行环境，归 OpenWork）、`m` 模型修订键
    （数字键 `2` 已有修订能力，纯重复入口）。Phase 1.5 只余"预览去截断"一个查看增强。
  - 执行环境（编辑器 / 文件管理 / 浏览器 / 长任务）一律归 **OpenWork**，边界不混。
- **网站 = 本地优先橱窗**：registry 的漂亮投影 + 真下载包；雇佣打通走本地 API 桥
  （`localStorage` ↔ `.crewclaw/team.json`）。托管市场（真账号 / 后端 / 云评分）= 远期里程碑，不提前。
- **TaskEvent additive-only**：协议只增不改；新事件加枚举变体，旧前端忽略未知事件即降级，不破坏 replay。
- **认证语义**：真评测分绑定 `spec_version` + 完整行为主体哈希 + 被测模型 + 判官模型 +
  provider endpoint 的不透明标识 + Node/依赖锁身份 + 时间戳；mock 分永不覆盖真分（落盘守卫）。
  任一被测行为、执行模型、依赖、运行时或判官身份变化 → 旧分作废需重评。
- **Feature 三问准入闸**：① 为什么"数字员工"需要它？② 解决哪个真实用户问题？③ 为什么不是普通 ChatGPT？
  三问答不齐的 Feature 不进本产品。

---

## 1. Review：审计诊断（逐条已核实代码）

| #   | 问题                                                                                                                                         | 性质                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| A   | `crewclaw.employee.yaml` 零代码消费；5 员工缺 4 份 spec、2 份 hire.yaml；validator if-exists 静默放过                                        | 规格是文档不是合同     |
| B   | `eval_suite`/`outcome_rubric` 没人执行；EVAL 屏"上岗考试"硬编码 mock                                                                         | 护城河未被证明         |
| C   | `@chaogeek/hermes` npm 404；本地启动命令写死 macOS 绝对路径（Windows 全废）；详情页手抄数据 + 编造 rating 4.9/hire 860；鲸/Zeneth 详情页 404 | 对外根本下载不了       |
| D   | SETTINGS BEHAVIOR 组（审批/预算/…）"存而不用"                                                                                                | 违反"无真明示"诚实原则 |
| E   | 四文件版本漂移（registry/hire/distribution/spec）；无任何 `*.schema.json`                                                                    | 无标准物、无守卫       |

---

## 2. 里程碑（已实现并部署，附 commit）

### A · 员工标准（两文件分层）— `b62d144`

`contracts/employee-spec.ts` strict Zod（eval_suite/outcome_rubric 必填，rubric 权重 Σ=1）；
`z.toJSONSchema` 生成 `contracts/schema/*.schema.json` 生态标准物 + drift-guard；backfill 5 员工
双文件（角色化真 smoke test）；validator 强制 available 必须双文件 + 四文件版本一致；鲸对齐 0.2.0。

### B · 评测 MVP（差异化核心）— `58af5ef`

`packages/runtime/eval-runner.mjs`：复用 conformance spawn 骨架真跑 smoke_tests → 读产物 → rubric
加权 0-100。两种诚实模式：`--mock`/CREW_MOCK = 机械 harness 检查（`graded_by:mechanical`，`mock:true`，
非认证分）；真模式 = 判官模型逐维度打真分（`mock:false`）。mock 不覆盖真分；无 key 无 --mock 报错退出。
`pnpm eval:expert <slug>`。EVAL 屏"上岗考试"三态：真分（model+日期）/ MOCK 跑（橙色非认证）/ 从未评测占位。

### 2a · 真实分发 — `1aae048`

`api/lib/pack-employee.ts` 纯 node 无依赖 tar+gzip 打包器（复用 validator forbidden 规则防泄密，
确定性 sha256）；`GET /api/employees/:slug/package`（tarball + `X-Checksum-Sha256`；`?meta=1` 返 JSON；
unknown/coming-soon → 404）；详情页真"Download package"按钮（gate 在 `local_source`）。

### 2b · 摘假评分 — `81f89ca`

市场卡片编造的 rating 4.8/hire 1.2k → 真 registry 事实（certification/version）。

### C4 · 审批策略接线 — `7b879b9`

`packages/runtime/tui/prefs.mjs` 读 Rust 持久化的 prefs；"信任后自动"在累计验收 ≥3（真 KPI）后自动
验收（仍发完整 approval.accepted + ProofPack，标 `auto:true`）；默认 = 手动闸（conformance 不动）。

### C3 · 月度预算 enforcement — `9bd8151`

`packages/runtime/spend.mjs`（`.crewclaw/spend/<YYYY-MM>.json`，cap 镜像 BUDGET_OPTS）；≥80% 发一次性
`budget.warning` → 通知中心第一个预算真源；≥100% 拒新任务。新 `NoticeKind::Budget`。SETTINGS 两行
（审批/预算）摘掉"引擎暂不支持"。

**基线全绿**：Rust 242 / runtime 58 / conformance 12/12 / vitest 30 / playwright e2e。

---

## 3. 收束拍（本版收尾，2026-07-10）——执行记录

- ✅ **PRD 定稿**（本文件）+ 边界宪章。
- ✅ **修 C4 半诚实 + 镜像表守卫** — `27adbc1`：审批策略收敛两档真语义（旧值迁移）；
  FORBIDDEN_NAMES 单源化（contracts/forbidden-paths.ts）；BUDGET/APPROVAL 选项表文本抽取 drift-guard。
- ✅ **退役 `src/data/employees.ts` 手抄** — `afba13c`：`pnpm run web:employees` 从 registry +
  hire.yaml + spec（双 Zod 校验）生成 `employees.generated.json`；rating/hire_count 从
  AgentEmployeeSchema 源头删除；真值排序（推荐/版本/名称/更新时间）；drift-guard + e2e 断言
  5/5 详情页可达（鲸/Zeneth 首次上架）。顺带揪出 runtime yaml.mjs fallback 真 bug：带冒号的
  引号数组项被误切成对象（changelog 全军覆没），已修 + 回归测试。
- ⛔ **第一个真认证分 — blocked（诚实记录，不造分）**：eval-runner 缺 .env.local 加载已修
  （`1ef6700`），但 ZENMUX_API_KEY 对所有 chat 模型返回 HTTP 403（直接探针验证：opus/sonnet/
  gpt-4o-mini/deepseek 全 403，/models 公开端点正常）= key 被撤销或余额耗尽。恢复 key 后一条命令
  出分：`pnpm eval:expert product-prd-crab`（crab 纯文本无搜索依赖；鲸另需搜索 provider key）。

### 3.1 外部评审 P0 核实与修复记录（6/6 属实，全部落地）

- **P0-a 假绿链** — `526734d`：批处理路径 outcome.checked 补发 `valid`（含落盘失败=false）；
  save 失败不再发 artifact.created；Rust reducer 缺 valid 改判「结果未知」不默认成功（三态）。
- **P0-b 工具授权污染 KPI** — `526734d`：approval.resolve 只发 approval.resolved，
  不再发 APPROVAL_ACCEPTED（工具授权 ≠ 交付验收）；bridge 级回归测试。
- **P0-c 权限边界** — `66a42ee`：workspace scope 自动放行仅限 root containment
  （isPathInsideRoot：~ 展开 + 相对化判定），root 外升级 confirm；bash 只读分类器堵重定向/
  链式/反引号/$()；路径逃逸负例测试。
- **P0-d 质量门** — `7640be4`：cargo fmt 清零；ESLint 12 errors→0（全真修零 disable：config
  豁免 omit 惯用法 / react-refresh 抽 lib / React19 adjust-during-render 等）；AGENTS.md 身份
  改为 AI 员工平台 + 边界宪章；Hermes 安装 E2E 使用跨平台确定性 shim，不再依赖本机二进制（原用户目录硬编码已修）。
- **仍保留的架构债**：run.mjs 仍是可执行入口而非可 import 的 engine library；eval-runner 通过受限
  子进程运行同一入口。测试清单、TypeScript 检查与 deterministic/live 分层已在后续 review 收口，
  不再把「未收集」或「常红」记成可接受现状。

### 3.2 2026-07-11 深度 review 收口（未虚构外部完成态）

- 交付验收改为不可变 decision receipt + 跨进程 settlement lock；接受前只暂存记忆候选，接受后才提交，
  crash recovery 幂等，拒绝/修订/EOF 不污染长期记忆。
- 所有核心状态读写统一 canonical containment、junction/symlink/hardlink 拒绝、所有权锁、8 MiB 上限、
  `0600` 同目录临时文件 + fsync + 原子替换；Windows delete-pending `nlink=0` 作为瞬态竞争重试。
- eval acceptance 变成逐条 hard gate，非 `task.completed` 生命周期记 0；认证结果绑定 subject contract v2、
  profile/spec/skills/runtime/contracts、package+pnpm lock、Node ABI、worker/judge model 与 endpoint hash。
- 员工包拒绝路径穿越、非便携 tar 名、链接、秘密内容与超限输入；Docker 构建先校验全部专家；
  生产服务使用构建期预生成包、单飞缓存、ETag/304，不再逐请求同步压缩。
- **外部阻塞仍诚实保留**：ZENMUX key 当前 403，尚无 `mock:false` 真认证分；公共 npm
  `@chaogeek/hermes` 仍未发布，因此生产页面只展示源码/本地安装路径。

---

## 4. 明确不做

- **永久裁掉**（边界宪章）：TUI 内 `e` 外部编辑器、`m` 修订键、任何编辑/文件操作类 Feature（归 OpenWork）。
- **远期，不提前**：托管市场（真账号 / 云后端 / 云评分）、npm 发布 `@chaogeek/hermes`、
  Runtime Adapter SDK、EVAL 月度条形 / REPUTATION 真值化（等真数据密度）、Performance 页真值化。

---

## 5. 尾段路线（收束拍后按序，只写不做）

- **Phase 3 · 成长闭环（下一内部目标）**：持久记忆与「accept 后才提交」事务基础已完成；下一步把
  `tool_needs` + `permission_policy` 从规格接进 preflight/tool gateway，做到声明缺失即阻断、权限超界即
  fail closed。外部 key 恢复后再完成 **同员工两次 `mock:false` 真评测分对比可观测**，证明成长闭环。
- **Phase 4 · 声誉 + 雇佣打通**：评测分 × KPI 验收率 × 用户评价聚合成 Reputation；本地 API 桥
  `localStorage` ↔ `.crewclaw/team.json`，网站"Hire"后终端 `crew chat` 直接可用。

---

## 6. 验收标准

- 全套：`vitest`（含 drift/security guards）/ deterministic `test:runtime` 82/82（2 个 live 前置条件单列）/
  `test:conformance` 12/12 / `cargo test` 264+ / `validate:all-experts` 5/5 / Playwright dev +
  真实 Hono production（页面、包 metadata、gzip/sha/ETag、unknown 404）。
- 真评测：`.crewclaw/eval/<slug>.json` `mock:false`；`crew chat` 进 EVAL 屏人眼见「真实（model·日期）」+ 真分。
- 网站：dev 起服务，鲸/Zeneth 详情页可达；`curl` 下载端点 sha 对齐、`tar -tzf` 干净。
- Rust 有改动 → release rename 部署 + 真机冒烟。
