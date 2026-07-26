# Good Employee Standard v1

状态：规范性标准  
版本：1.0.0  
生效日期：2026-07-16

## 1. 定义与适用范围

数字员工是一个被组织授予明确岗位、工具和权限，能够在可观察、可控制、可验收的前提下，持续交付工作成果的软件执行单元。

CrewClaw 认证的对象不是人设、模型或一次演示，而是以下内容组成的可复验职业单元：

- 版本化 Employee Package；
- 明确岗位合同、责任边界和禁区；
- 实际 Runtime、工具、权限和预算；
- 可检查的 Artifact、事件与证据；
- 在重复标准任务上的稳定表现；
- 可追溯、可审核、可回滚的记忆状态。

自测、宣传文本、作者声明和单次成功均不得构成认证。

## 2. 证据等级

| 等级 | 必要状态                                   | 可以宣称                                                | 不可以宣称                   |
| ---- | ------------------------------------------ | ------------------------------------------------------- | ---------------------------- |
| C0   | Package 为 `draft`                         | 草稿、概念验证                                          | 可部署、已验证、已认证       |
| C1   | Package 为 `validated`                     | 包结构与安全规则已验证                                  | 稳定胜任、CrewClaw Certified |
| C2   | C1 + 当前有效的签名 Lab Credential         | 在指定 Profile、Runtime、模型和记忆状态下通过实验室认证 | 跨 Runtime 或跨版本泛化能力  |
| C3   | C2 + 独立、可验证的真实使用证据为 `proven` | 在声明范围内经真实使用验证                              | 未被证据覆盖的长期表现       |

等级必须由 `package_status`、`lab_status` 和 `field_status` 推导，不能由员工包自行填写后生效。

## 3. 六项认证维度

认证至少衡量：

1. 岗位能力：完成岗位标准任务，而不是只给建议；
2. 交付质量：Artifact 完整、可用、可修改、符合验收标准；
3. 稳定性：每类任务重复运行并达到成功率及置信下界；
4. 工具纪律：正确选工具、降级、止损和报告阻塞；
5. 安全与治理：遵守权限、数据、预算和外部副作用边界；
6. 经济性：成本和耗时来自 Runtime 证据且不超过门限。

员工价值按乘法理解：能力 × 稳定性 × 可控性 × 交付质量 × 成本效率。任一硬门禁失败，整体认证失败。

## 4. Formal Certification Protocol

正式认证必须满足：

- Profile 由认证方版本化管理，员工自带 `eval_suite` 仅用于开发自测；
- `mock_allowed: false`，所有通过运行的 `mock` 必须为 `false`；
- Worker 与 Judge 模型独立；Profile 要求独立 Judge 时二者不得相同；
- 每个 Case 重复执行，运行次数满足 Profile 的 `min_total_runs`；
- 每次运行记录终态、Judge 检查、证据覆盖率、成本、耗时、权限与安全违规；
- 正常任务必须有真实 Artifact；正确止损任务不得伪造 Artifact，且必须有停止原因；
- 通过运行必须有 Runtime 成本证据，未知成本不能通过；
- 硬门禁、总体成功率、分 Case 成功率、Wilson 置信下界、正确止损率和 P95 预算全部达标；
- Credential 使用 Ed25519 签名，并绑定 Employee Package `subject_hash`、活动记忆 `memory_state_hash`、Profile、Runtime、Worker/Judge 和逐次回执；
- 默认有效期 90 天；到期、撤销、Package 改变或活动记忆改变后不得继续作为 C2 证据。

## 5. Dream、成长与再认证

Dream 只能生成候选记忆。候选必须有来源、Diff、真实基线与候选评测、人工批准和可回滚归档。

激活候选或回滚到旧记忆都会改变执行主体。状态切换必须先写入认证失效回执，再切换活动记忆；随后员工降回 C1，直到用新 `memory_state_hash` 完成正式再认证。对未变化的记忆重复操作不得误使当前 Credential 失效。

## 6. 核心证据对象

- Certification Profile：岗位考试范围、重复次数、终态、证据和门限；
- Run Receipt：一次真实运行的终态、Judge、证据、成本、耗时和违规记录；
- Certification Credential：签名后的聚合认证结论；
- KPI Ledger v2：只追加的正式任务、聊天和 Artifact 操作结果账本；
- Employee Proof Pack：面向公开或内部使用的当前状态、Credential、KPI、任务证据和 Dream 状态投影。

公开 Proof Pack 必须隐藏本地路径和任务标识；内部版本可以保留审计引用。任何篡改都必须导致完整性校验失败。

## 7. 声明规则

- `Package Validated`、`C1` 与 `Certified`、`C2` 必须严格区分；
- 没有当前有效签名 Credential 时，界面、README、CLI、Registry 和演示数据均不得显示“已认证”或 C2；
- MOCK 分数必须显式标注，且不能覆盖真实认证；
- 正确阻塞是专业结果，但必须与成功交付分开统计；
- 自动接受必须标记为 policy acceptance，不能伪装成用户接受。

## 8. AI 落地鲸 v1 最低试岗集

Profile `ai-adoption-whale/v1` 包含 8 类任务、每类 3 次，共 24 次非 MOCK 运行：官方模型发布调研、JS 动态官方页面、不存在型号核验、带证据选型、可修改 ROI、缺失工具正确阻塞、预算止损、未授权生产操作拒绝。

只有 24 次运行和所有门禁真实通过并签发 Credential 后，AI 落地鲸才可从 C1 提升为 C2。

## 9. 验证命令

```text
pnpm run schema:generate
pnpm run validate:all-experts
pnpm run certify:employee -- ai-adoption-whale --profile certification/profiles/ai-adoption-whale-v1.yaml
pnpm run test:runtime
pnpm run test:conformance
```

认证命令需要真实模型凭据；缺失凭据时必须失败，不允许回退到 MOCK。最终发布还必须通过类型、Lint、单元、Rust、Web 构建、CLI/TUI 与浏览器端到端验证。
