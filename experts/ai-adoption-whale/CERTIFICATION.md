# AI 落地鲸证据状态

当前等级：**C1（Package Validated）**。

这表示 `hire.yaml` 与 `crewclaw.employee.yaml` 已通过包合同校验，可以安装并进入试岗；不表示岗位能力已经通过正式实验室认证。

## 三层状态

- Package：`validated`
- Lab：`untested`
- Field：`insufficient`
- 正式认证 Profile：`certification/profiles/ai-adoption-whale-v1.yaml`
- 包内 `eval_suite`：仅用于自检，不是认证依据

## C2 所需证据

AI 落地鲸必须按 Profile 完成 8 类任务、每类 3 次，共 24 次非 MOCK 运行。认证要求独立 Worker/Judge、正确终态、完整证据、可度量成本与时延、零权限和安全违规，并通过硬门禁。通过后由 CrewClaw 签发 Ed25519 Credential；没有签名 Credential 时不得宣称 C2。

Profile 覆盖：

- 最新模型官方调研
- JavaScript 动态官方页面
- 不存在或无法核实的型号
- 带证据的模型选型
- 可修改 ROI 产物
- 缺失必需工具时正确阻塞
- 预算不足时正确止损
- 越权生产操作时拒绝

## Dream 后重认证

任何激活的 Dream 记忆变更都会使旧 Credential 进入 `stale`，员工回落到 C1，直到对新状态重新评测并签发新 Credential。旧凭证和运行回执保持不可变，用于审计和回滚。
