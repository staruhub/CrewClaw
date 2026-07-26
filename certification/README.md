# CrewClaw Certification

正式认证遵循 [Good Employee Standard v1](../docs/good-employee-standard-v1.md)。员工自带 `eval_suite` 是开发自测，不会自动获得 C2。

## 运行认证

```text
pnpm run certify:employee -- <employee-id> --profile <profile.yaml> [--json] [--no-persist]
```

认证运行器拒绝 MOCK，要求显式独立 Judge，并把每次运行的终态、证据、成本、耗时和违规情况写入签名 Credential。默认 Credential 有效期为 90 天，并绑定当前 Employee Package 与活动记忆状态。

AI 落地鲸示例：

```text
pnpm run certify:employee -- ai-adoption-whale --profile certification/profiles/ai-adoption-whale-v1.yaml --json
```

当真实模型凭据、Runtime 能力或必要工具缺失时，命令必须明确失败或生成失败 Credential；不得回退到 MOCK，也不得用 `eval_suite` 结果替代认证。
