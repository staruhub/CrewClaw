# CrewClaw M0 — 地基对齐（Foundation）设计

版本：v1
状态：Draft（待用户审查）
日期：2026-06-22
里程碑：M0（5 里程碑路线图的第 1 个）
PRD 依据：`crewclaw_prd.md` §12（Manifest）、§13（数据模型）、§24（技术假设）、§27（MVP 验收）、§28（文案基调）
执行方式：Claude 编排 + codex crew 并行执行（`codex-companion.mjs task --background --write`）

---

## 1. 背景与目标

"员工是什么"目前有三套并存且互不一致的描述：

| 来源 | 形态 | 用途 | 问题 |
|---|---|---|---|
| `registry/experts.json` | 旧 JSON schema（name/display_name/status/requires/first_task…） | CLI 读取、展示 | 字段与 PRD Manifest 不对齐；无 macao |
| `experts/<name>/distribution.yaml` | 包分发清单 | 安装、校验 | 与 registry 字段重复、口径不一 |
| `agents/macao-networking-agent/hire.yaml` | `crewclaw/v1, kind: Employee` Manifest | macao 专用 | 格式最贴 PRD，但只有 macao 用，且不在 registry |

M1–M4（CLI 闭环、前端市场、创作者/审核、信任/埋点）全部要读"员工是什么"。**不先统一，后面每个里程碑都在三套口径之间打架。**

**M0 目标**：确立**唯一的 Employee Manifest 标准**与**唯一的数据模型契约**，让三个员工（含 macao）同构、可被 `crew list/hire`、通过校验器。这是地基，本身不产出新用户功能。

## 2. 范围

**做（P0 地基）**
- 统一 Employee Manifest 标准（crewclaw/v1）。
- 定义 4 个数据模型契约（PRD §13）。
- macao 接入：迁入 `experts/`、补齐标准包、补 2 个缺失 skill、进 registry。
- 校验器按新标准校验全部员工包。

**不做（留给后续里程碑）**
- 新增 CLI 命令 `search/inspect/submit`（M1）。
- 任何前端页面（M2）。
- 创作者后台、审核队列（M3）。
- 埋点、指标面板（M4）。
- 真数据库 / 后端持久化（本里程碑用文件，见 §4.6）。

## 3. 设计

### 3.1 统一 Employee Manifest（crewclaw/v1）

以 macao 的 `hire.yaml`（`apiVersion: crewclaw/v1, kind: Employee`）为骨架，并入 PRD §12 字段，作为**唯一权威的"员工说明书"**。每个员工包根目录放一份 `hire.yaml`。

字段（合并 macao 现有结构 + PRD §12）：

| 区块 | 字段 | 必填 | 来源/说明 |
|---|---|---|---|
| `apiVersion` / `kind` | — | ✅ | 固定 `crewclaw/v1` / `Employee` |
| `metadata` | id, name, mascot, version, certification, published_by, creator | ✅ | PRD: id/name/version/creator |
| `identity` | title(=role), description(一句话), reports_to, location | ✅ | PRD: role/description/identity |
| `soul` | 工作风格与原则（一句话摘要，详写在 `SOUL.md`） | ✅ | PRD: soul |
| `skills` | 技能名列表（对应 `skills/**/SKILL.md`） | ✅ | PRD: skills |
| `tools` | 工具列表（browser/contacts/calendar/mailbox…） | ✅ | PRD: tools |
| `permissions` | 最小权限声明（`calendar:read`、`contacts:write`…） | ✅ | PRD: permissions |
| `requires` | hermes, runtime, env[] | ✅ | PRD: install_requirements |
| `examples` | inputs[], outputs[] | ✅ | PRD: input/output_examples |
| `limitations` | 能力边界列表 | ✅ | PRD: limitations |
| `sla` | response_time, availability, escalation | ⬜ | macao 现有 |
| `lifecycle` | hireable, fireable, trial_period | ✅ | macao 现有 |
| 可选 | pricing, categories, tags, demo_tasks, changelog, support_url, safety_notes | ⬜ | PRD §12.2 |

**渐进、不破坏**：现有 `experts/*/distribution.yaml` **保留**（CLI/validator 继续兼容），但 manifest 真相以新增的 `hire.yaml` 为准。shrimp/crab 的 `hire.yaml` 由其现有 `distribution.yaml` + `registry` 条目映射生成。

zod schema：`contracts/manifest.ts`（导出 `EmployeeManifestSchema` + 推导类型 `EmployeeManifest`）。

### 3.2 数据模型契约（PRD §13）

落在 `contracts/`（TS 类型 + zod），前端/后端/CLI 共用同一份字段定义。CLI 侧（Rust）对应 struct 镜像同名字段。

- **AgentEmployee**（市场展示对象）：employee_id, name, role, creator_id, description, status(`draft|review|published|disabled`), verified, categories[], tags[], rating, hire_count, created_at, updated_at。**派生自** manifest + registry。
- **EmployeePackage**（包本体）：package_id, employee_id, version, manifest, package_url, checksum, release_notes。
- **WorkspaceEmployee**（用户团队中已雇佣员工）：workspace_employee_id, workspace_id, employee_id, version, status(`active|warning|broken|fired`), hired_by, hired_at, fired_at, permissions_granted[]。**M0 仅定义类型**，读写在 M1（CLI hire/fire）落地到 `.crewclaw/team.json`。
- **DoctorReport**（体检报告）：report_id, workspace_employee_id, health_status(`healthy|warning|broken`), issues[], suggestions[], checked_at。**M0 仅定义类型**，逻辑在 M1（doctor）。

### 3.3 注册表统一

`registry/experts.json` 角色收敛为**市场索引**（轻量、可快速列表/搜索），权威细节在各员工 `hire.yaml`。

- 升级 `experts.json` 条目 schema 与 AgentEmployee 对齐（补 category/tags/verified 等，已基本具备）。
- **新增 macao 条目**，`local_source: experts/macao-networking-agent`、`status: available`，成为第 3 个可见员工。条目须满足现有 CLI `Expert` 反序列化要求（`display_name`/`certification`/`description`/`requires{hermes,env}`/`first_task`），其中 `first_task` 对齐 PRD §23.4 示例任务，避免 `crew list` 解析失败。
- 提供一个一致性约束：registry 条目的 `name/version/local_source` 必须与对应 `hire.yaml` 一致（由校验器检查）。

### 3.4 macao 接入

1. 把 `agents/macao-networking-agent/` **迁入** `experts/macao-networking-agent/`。
2. 补齐标准包文件（对齐 AGENTS.md 清单）：`distribution.yaml`、`mcp.json`、`.env.EXAMPLE`、`README.md`、`CERTIFICATION.md`、`EXAMPLES.md`、`EVALS.md`、`CHANGELOG.md`；保留并校正现有 `hire.yaml`、`config.yaml`、`SOUL.md`。
3. **补 2 个缺失 skill**：`skills/networking/lead-matcher/SKILL.md`、`skills/networking/dinner-recommender/SKILL.md`（hire.yaml 已声明但文件缺失）；现有 `icebreaker`、`follow-up-writer` 归入 `skills/networking/` 分组层，使其与 experts 既有结构（`skills/<组>/<名>/SKILL.md`）一致。
4. skill 内容遵循现有 SKILL.md 格式（frontmatter + Overview/When to Use/Workflow）。
5. 权限/工具按 PRD §23.3：浏览公开网页✅、读联系人/写 CRM 暂不默认、自动发消息禁止（须确认）——manifest `permissions` 与之对齐。

### 3.5 校验器对齐（`packages/validator`）

- 加载并按 `EmployeeManifestSchema` 校验每个员工的 `hire.yaml`。
- 校验 registry ↔ hire.yaml 一致性（name/version/local_source）。
- 保留对 `distribution.yaml` 及标准文件清单的既有检查。
- 高风险权限（`mailbox:send`、`contacts:write`、付款、删除）→ 标记（PRD §14.7/§15，为 M3/M4 预留）。

### 3.6 数据层（决策：A 文件优先）

- **员工目录**（AgentEmployee / EmployeePackage / Manifest）= 文件：`registry/experts.json` + 各 `experts/<name>/hire.yaml`。前端 `src/data/experts.ts` 继续从 registry 派生。
- **运行时状态**（WorkspaceEmployee / DoctorReport）= 本地 JSON：`.crewclaw/team.json`（M1 落地，M0 仅定类型）。
- 理由：零基础设施、Demo 友好、CLI 天然读文件、codex 并行不撞车，契合 PRD §24"别被基础设施拖死"。DB（drizzle+MySQL）留作 P1 可选，不影响契约。

## 4. 文件清单

**新增**
- `contracts/manifest.ts`（EmployeeManifestSchema + 类型）
- `contracts/types.ts` 扩展：AgentEmployee / EmployeePackage / WorkspaceEmployee / DoctorReport（+ zod）
- `experts/macao-networking-agent/`（迁入 + 补齐标准包 + 2 skill）
- `experts/macao-networking-agent/hire.yaml`（校正后的权威 manifest）
- `experts/code-review-shrimp/hire.yaml`、`experts/product-prd-crab/hire.yaml`（由 distribution.yaml 映射生成）

**修改**
- `registry/experts.json`（schema 升级 + 新增 macao 条目）
- `packages/validator/**`（按新 schema 校验 + 一致性检查）
- CLI（`crates/crewclaw-cli`）：`Expert`/`Registry` struct 与新 registry 字段对齐（保持 `crew list` 正常）

**删除/迁移**
- `agents/macao-networking-agent/` → 迁移至 `experts/`（迁移后清空旧目录）

## 5. 验收标准（可测试）

| 编号 | 标准 | 验证命令 |
|---|---|---|
| M0-AC-1 | 类型检查通过 | `pnpm run check` |
| M0-AC-2 | 全部 3 个员工通过校验 | `pnpm run validate:all-experts` |
| M0-AC-3 | `crew list` 显示含 macao 的 3 个 available 员工 | `pnpm run crewclaw list` |
| M0-AC-4 | 单测 + Rust 测试通过 | `pnpm test` |
| M0-AC-5 | 并行验证全绿 | `pnpm run crewclaw verify` |
| M0-AC-6 | registry ↔ hire.yaml 一致性校验生效（故意改不一致会报错） | validator 单测 |

## 6. codex 并行任务拆分

依赖：**卡 A（契约层）先行**，其余三卡依赖 A 的类型/ schema，A 完成后并行。

| 卡 | 目标 | 涉及文件 | 验收 | 禁碰区 |
|---|---|---|---|---|
| **A 契约层**（先行，effort high） | 统一 manifest zod schema + 4 实体类型 | `contracts/manifest.ts`、`contracts/types.ts` | `pnpm run check` 过；导出符号齐全 | 不改 CLI、registry、experts/ |
| **B registry+CLI**（依赖 A，high） | registry schema 升级 + macao 条目 + CLI struct 对齐 | `registry/experts.json`、`crates/crewclaw-cli/src/main.rs` | `crew list` 显示 3 员工；`cargo test` 过 | 不改 experts/ 内容、validator |
| **C macao 包**（依赖 A，medium） | 迁入 experts/ + 补标准包 + 2 skill + 分组 | `experts/macao-networking-agent/**` | 目录含全部标准文件 + 4 个 SKILL.md | 不改 registry、其他 experts |
| **D validator**（依赖 A，medium） | 按 schema 校验 + 一致性检查 + 高风险权限标记 | `packages/validator/**` | `validate:all-experts` 过；不一致用例报错 | 不改 experts/ 内容、CLI |

合并顺序：A → (B‖C‖D) → 我跑全量验收（§5）→ 解冲突 → `crew verify`。

## 7. 测试策略

- **契约**：zod schema 单测（合法/非法 manifest）。
- **validator**：合法包通过、缺字段/不一致/高风险权限的负例报错。
- **CLI**：`cargo test`（registry 解析、`list` 输出含 macao）。
- **集成**：`pnpm run crewclaw verify`（scripted）全绿。
- 每张 codex 卡要求自带测试（codex 自带 superpowers/TDD），合并前我用 `codex-companion review` 或自审 + 跑上述命令把关。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 改动现有可用员工（shrimp/crab）引入回归 | 只**新增** hire.yaml，不删 distribution.yaml；改动后跑全量验收 |
| macao 迁目录破坏现有 hire 动画/scenario 引用 | 先 grep 引用（`agents/macao`、hire-scenario），同步更新路径 |
| codex 并行改 registry/contracts 撞车 | 卡 A 先行串行；B/C/D 文件域不重叠；必要时各自 worktree |
| manifest 字段与 PRD 偏离 | 字段表逐条对回 PRD §12/§13；validator 强校验 |

## 9. 非目标

不在 M0：DB/后端持久化、前端、新 CLI 命令、创作者/审核、埋点、支付。这些由 M1–M4 各自的 spec 承接。
