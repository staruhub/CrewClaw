# 条件式 Dream 设计（已拍板版）

> 2026-07-11 用户拍板。研究背景见 [dreaming-machine-research.md](./dreaming-machine-research.md)。
> 本文是 M0-M5 的执行契约：架构三层闭环 + 两项拍板决策 + M0 执行记录。

## 三层闭环

```text
TaskRun → Reflect 工作日志（确定性提取，不调模型，不进活跃记忆）
              ↓
       DreamController 资格判断（硬门槛 + 软触发 + 推荐分）
              ↓
       推荐计划 → 用户确认生成（确认前零模型成本）
              ↓
       候选记忆库 + 结构化 Diff（独立制品，绝不原地改活跃库）
              ↓
       Schema/来源/安全/Critic 校验 + 候选评测 + 人工审批
              ↓
       原子激活（base_memory_hash 二次确认 + 归档）/ 拒绝 / 回滚
```

## 拍板决策（2026-07-11）

### 决策一：学习切换策略 —— 不接受线上学习空窗

```text
当前生产：       accept → legacy memory commit（commitAcceptedTaskMemory）
M1–M4 开发分支： accept → immutable reflection → batch dream → candidate → approval + activation
M4 一次性发布：  新管线默认开启；旧管线保留为【关闭状态的回滚开关】
M5 稳定后：      删除 legacy learning
```

硬规则：

- 生产环境不得出现"任务已验收但员工完全不再积累经验"的窗口。
- 新旧管线不得同时写 active memory（禁双写）。
- 回滚开关仅管理员可启用，启用必须写审计事件。
- **M1–M4 在同一个 feature branch 连续完成，一次合入，不拆多版本发布。**
- `commitAcceptedTaskMemory` 在 M1 迁到 `legacy_learning` feature flag 后面，不物理删除；
  待 M4 激活链路稳定、M5 前后评测跑通一个版本后再清理。

### 决策二：基线门槛拆成两道门（ZENMUX 403 不成为架构单点）

- **Curation Eligibility（可策展）**：accepted tasks 足量 / 输入可信 / 员工空闲 / 预算允许 /
  冷却结束 / 存在重复·冲突·过期·记忆压力 → 可以推荐并生成候选。
- **Activation Eligibility（可激活）**：当前 memory hash 有匹配基线 / 候选评测通过 /
  安全分不退步 / 人工审批完成 / base_memory_hash 未变化 → 才允许激活。

无基线时 DREAM 屏必须显示"可策展但不可激活 + 阻塞原因 + 下一步（运行认证评测）"，
不许静默不推荐。严格原则不变：**没有真实基线可以生成候选，但绝不允许激活。**
M5 前置：Eval 调用抽象为 EvalProvider（available / missing_credentials /
authentication_failed / rate_limited / unavailable），测试用确定性 fake provider 验流程；
生产激活仍要求 `mock:false + provider_status:verified`。

### Reflect 的边界（调整二）

确定性 Reflect 只抽取已发生的可信事实（accepted 与否 / 用户反馈 / 被接受的 Artifact /
Outcome Check 结果 / 已验证的工具失败 / Evidence / 成本时间），**不自己推断"以后该怎么做"**
——跨任务判断属于 Dream。可信池准入仅限：用户验收、Outcome Grader 通过、确定性测试通过、
用户明确偏好、带 Evidence ID 的已验证根因。外部网页/上传文档/工具原始输出只能作为
Evidence 引用，不能作为记忆正文。

### 事件部署纪律

- Node event schema 与 Rust enum、reducer、UI、协议测试**同一个 commit**。
- 每个里程碑合入必须重建部署 exe（v0.19 起未知事件在 TUI 显示为协议错误，不静默）。
- 后续（M2+）实现 `protocol.ready` / `client.ready` 的 event family 协商：
  客户端未声明支持 `dream/v1` 时，引擎不发对应事件，改写 Inspect 或兼容摘要。

## 契约冻结（M0.1，已实现）

| 契约                            | Schema 位置                             | 用途                                   |
| ------------------------------- | --------------------------------------- | -------------------------------------- |
| `crewclaw.memory-item/v2`       | contracts/dream.ts `MemoryItemV2Schema` | 记忆条目生命周期+溯源                  |
| `crewclaw.reflect/v1`           | `ReflectionSchema`                      | 不可变任务工作日志                     |
| `crewclaw.dream-job/v1`         | `DreamJobSchema`                        | 一次 Dream 运行全记录（含状态机）      |
| `crewclaw.dream-candidate/v1`   | `DreamCandidateSchema`                  | 候选库（recall 永不直读）              |
| `crewclaw.dream-diff/v1`        | `DreamDiffSchema`                       | add/merge/replace/drop/keep + 逐项溯源 |
| `crewclaw.dream-approval/v1`    | `DreamApprovalSchema`                   | 不可变审批回执                         |
| `crewclaw.memory-activation/v1` | `MemoryActivationSchema`                | 原子切换记录                           |
| `crewclaw.memory-state-hash/v1` | packages/runtime/memory-hash.mjs        | 成长判断锚点                           |

`dream_policy` 从 `passthrough()` 收紧为正式 Schema：顶层未知字段拒绝；
`mode/triggers/eligibility/budget/input_policy/promotion_policy/cooldown/limits/extensions`；
第三方实验字段只进 `extensions`；legacy `after_task/retention` 显式收编为 deprecated
（M1 迁移其语义后在后续 spec 版本移除）。JSON Schema 同步生成到 `contracts/schema/`
（9 份，drift-guard 守护）。

## memory_state_hash 规则（M0.2，已实现并测试）

- 只含 `status:"active"` 条目（缺 status 按 active，兼容 backfill 前的 legacy 条目）。
- 语义字段固定序：`category, confidence, supersedes, text, valid_until`；
  volatile 字段（savedAt/read 计数等）排除。
- 文本规范化 v1 固定：Unicode NFC → trim → 内部空白折叠为单空格。
- 条目按 (category, normalized text) 码元序排序（无 locale 依赖）。
- 输出：`{memory_state_hash: "sha256:…", memory_hash_schema, active_item_count,
estimated_injection_tokens}`；token 估算算法固定（CJK/全宽=1，其余 4 字符=1，明示 estimate）。
- 改任何规则必须升 schema 版本，否则历史报告不可比。

## Eval 报告绑定（M0.3，已实现）

新增：`memory_state_hash / memory_hash_schema / memory_item_count / memory_injection_tokens /
judge_prompt_version`（`crewclaw.judge-prompt/v1`，换判官措辞必须升版本）。
既有字段已覆盖其余要求：spec_version+spec_hash（题集随 spec）、subject_hash（员工包行为输入）、
dependency_hash、runtime_identity、execution_context(+hash，含 provider/endpoint/timeout)、
worker_model/judge_model(+endpoint id)、mock、evaluated_at。
**当前评测在隔离空 root 运行、不注入记忆 → 如实绑定空集哈希**；M5 基线/候选评测通过
`runEval({stagedMemoryItems})` 传入实际 staged 集，绑定自动变真，无需改动。

## 存储目录与制品边界（M0.4，已实现 path 契约）

```text
.crewclaw/
  reflections/<employee>/<task-id>.json        不可变任务日志
  dream/<employee>/jobs/<dream-run-id>.json
  dream/<employee>/candidates/<dream-run-id>/  candidate-memory.json + diff.json + validation.json
  dream/<employee>/approvals/<dream-run-id>.json
  dream/<employee>/activations/<activation-id>.json
  dream/<employee>/archives/<memory-state-hash>.json   激活前快照（回滚）
```

边界：reflections 只增不改；candidates 永不被 recall 直读；活跃库仍在
`.crewclaw/memory/<employee>.json`（现有格式）；一切变更走 state-lock（锁+临时文件+原子替换）；
Dream Job 保存 `input_snapshot_hash`，审核期间底库变化 → 候选标 stale 禁止激活。

## Legacy backfill（M0.5，已实现并测试）

`pnpm run memory:backfill [slug]`：为存量条目补
`{status:"active", source_type:"legacy", source_task_ids:[], evidence_ids:[],
created_by_model:null, dream_run_id:null}`。幂等（二跑零写入零备份）；仅追加不改既有字段；
变更前自动备份 `<file>.pre-v2-<ts>.bak`；recall 顺序/内容/memory_state_hash 不变
（测试断言）；旧 Runtime 可读（纯增量 JSON 字段）。不伪造溯源：legacy 条目的
source_task_ids 恒为空。

## M0 完成状态

M0 十条完成定义全部满足；`accept → addMemory` 路径保持原样；未发出任何新的运行态
`dream.*` 事件（契约与 Schema 均为静态制品）。验证证据见 M0 提交的 commit message。

## 后续里程碑（feature branch `dream-m1-m4`，一次合入）

- **M1（完成）** Reflect 拆分：`reflectTaskRun` 确定性提取落 reflections/；
  `commitAcceptedTaskMemory` 迁到 `legacy_learning` flag（默认开，保持生产行为）。
- **M2（完成）** DreamController：两道门、软触发/推荐分/冷却、可信池与诚实成本估算；
  `protocol.ready/client.ready` 协商后才启用 `dream/v1`。事件族冻结为 9 个
  （recommended/started/candidate_ready/validation_failed/blocked/approved/rejected/activated/
  rolled_back），动作冻结为 5 个（run/inspect/approve/reject/rollback）。M2 只落
  `RECOMMENDED` job，明确 `generation_available:false`；M3 前不伪装成已开始策展。
- **M3** Dream job：确定性预处理 → 强模型策展 → 候选+diff → 四道校验。
- **M4** 审批+激活：DREAM 屏真值化；approve/reject/rollback；原子切换+归档；
  发布时 flag 翻转（新管线默认开，legacy 变回滚开关）。
- **M5** EvalProvider + 候选评测 + 晋升门 + Growth Card（真实激活前置：真实基线，
  即 ZENMUX key 或第二 Judge Provider 就绪）。
