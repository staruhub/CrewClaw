export const manualZhCN = {
  "nav.backHome": "返回首页",
  "hero.title": "CrewClaw 用户手册",
  "hero.subtitle": "从发现、雇佣到监督、复盘，按现在已经有的能力一步步用。",

  "section.what.title": "什么是 CrewClaw？",
  "section.what.description":
    "CrewClaw 是一个本地优先的 AI 员工平台：从市场发现候选人，审查合同与权限，完成 Doctor 检查和试工，再监督任务、检查证据、人工验收并用真实表现更新 KPI。",
  "section.what.not": "CrewClaw 不是：",
  "section.what.not.chat": "不是通用 AI 聊天界面",
  "section.what.not.replacement":
    "不是 OpenWork 的替代品（CrewClaw 负责雇佣员工；OpenWork 是桌面工作台）",
  "section.what.not.hosted": "不是托管服务或 SaaS 产品",
  "section.what.not.paid": "不是付费产品。完整 Apache-2.0 开源。",

  "section.requirements.title": "系统要求",
  "section.requirements.git": "Git",
  "section.requirements.nodejs": "Node.js 22.22.0 或更高版本",
  "section.requirements.pnpm": "pnpm 10.33.2（由 package.json 固定）",
  "section.requirements.rust": "稳定版 Rust 工具链，包含 rustfmt 和 clippy",
  "section.requirements.chromium": "Chromium（仅用于浏览器端到端测试）",
  "section.requirements.hermes": "Hermes（仅在安装员工或运行模型任务时需要）",
  "section.requirements.note":
    "网站准备本地雇佣意图但不执行模型任务。仅在雇佣员工或运行需要模型的任务时才需要 Hermes。",

  "section.install.title": "从源码安装",
  "section.install.clone": "克隆仓库：",
  "section.install.setup": "启用 Corepack 并安装依赖：",
  "section.install.verify": "验证安装：",
  "section.install.build": "构建项目：",
  "section.install.start": "启动 Web 界面：",
  "section.install.open": "在浏览器中打开 http://localhost:3000/ 访问市场。",

  "section.hire.title": "雇佣第一位员工",
  "section.hire.intro":
    "CrewClaw 使用官方 Hermes profile 命令安装员工。雇佣流程包括合同审查、Doctor 检查和可选的试工任务。",
  "section.hire.list": "列出可用员工：",
  "section.hire.interactive": "不带参数运行 crewclaw 可打开交互式员工选择器。",
  "section.hire.direct": "直接雇佣员工（带确认）：",
  "section.hire.trial": "雇佣并运行试工任务：",
  "section.hire.check": "检查系统就绪状态：",

  "section.lifecycle.title": "员工生命周期",
  "section.lifecycle.intro":
    "CrewClaw 中的每位 AI 员工都遵循完整的、可审计的生命周期：",
  "section.lifecycle.discover.title": "1. 发现",
  "section.lifecycle.discover.body":
    "浏览市场，按角色、证据级别和能力需求查找员工。",
  "section.lifecycle.review.title": "2. 审查合同",
  "section.lifecycle.review.body":
    "检查 hire.yaml（角色、权限、工具）和 crewclaw.employee.yaml（运行时规范、成果标准和评估套件）。",
  "section.lifecycle.doctor.title": "3. Doctor 检查",
  "section.lifecycle.doctor.body":
    "开工前，Doctor 验证合同完整性、权限边界、工具可用性、记忆设置、预算限制、运行时兼容性和证据捕获就绪状态。",
  "section.lifecycle.trial.title": "4. 试工",
  "section.lifecycle.trial.body":
    "新员工可以在限定权限下运行首个任务，以验证合同并展示核心能力。",
  "section.lifecycle.supervise.title": "5. 监督",
  "section.lifecycle.supervise.body":
    "Node TaskEvent 运行时记录任务事件。Rust/Ratatui Workbench 实时显示动作、成本、证据、产物和审批门禁。",
  "section.lifecycle.approve.title": "6. 审批或退回",
  "section.lifecycle.approve.body":
    "没有可验证证据的交付无法通过验收。人工审核员检查产物，批准完成的工作，或带反馈退回任务。",
  "section.lifecycle.improve.title": "7. 复盘与改进",
  "section.lifecycle.improve.body":
    "审批后更新 KPI。Dream 复盘捕获有效做法和改进方向。所有数据保留在本地。",

  "section.beta.title": "Beta 0.8 限制",
  "section.beta.intro":
    "CrewClaw Beta 0.8 是预发布版本。接口和本地状态格式可能变化。已知限制包括：",
  "section.beta.validation":
    "注册表验证（C1）确认包结构，但不是签名的实验室认证。",
  "section.beta.openwork":
    "OpenWork v0.1.1 是未签名的 Windows 预发布版。Windows 可能显示发布者警告。该版本不包含 macOS 和 Linux 安装程序。",
  "section.beta.openwork.scope":
    "OpenWork 当前提供本地桌面任务、计划审批、Hermes 单次执行、持久历史、员工包导入、工作区选择、记忆事实和只读技能索引。浏览器自动化、Office 编辑、调度和多 Agent 编排不属于当前发布。",
  "section.beta.stateChanges": "接口和本地状态格式在 Beta 阶段可能仍会变化。",
  "section.beta.modelUsage":
    "提供商和模型用量（配置后）由这些提供商向你自己的账户收费。",

  "section.support.title": "支持与安全",
  "section.support.intro":
    "CrewClaw 以 Apache-2.0 发布，不包括商业支持或保证响应时间。",
  "section.support.bugs": "对于可复现的 Bug 和功能建议：",
  "section.support.github": "使用 GitHub Issues",
  "section.support.before": "开启 issue 前：",
  "section.support.search": "搜索已存在的 issue",
  "section.support.doctor": "当涉及 CLI 时运行 pnpm run crewclaw -- doctor",
  "section.support.info":
    "包含你的操作系统、Node.js 版本、pnpm 版本、Rust 版本、CrewClaw 版本以及相关的已清理日志",
  "section.support.sanitize": "移除凭据、个人数据、本地路径和员工工作产物",
  "section.support.security": "对于安全漏洞：",
  "section.support.securityNote":
    "不要在公开 issue 中报告漏洞、泄露的凭据或私有用户数据。请遵循 SECURITY.md 中的说明。",

  "section.resources.title": "其他资源",
  "section.resources.readme": "项目 README",
  "section.resources.releases": "发布说明",
  "section.resources.support": "支持政策",
  "section.resources.security": "安全政策",
  "section.resources.contributing": "贡献指南",
  "section.resources.demo": "57 秒概念片",

  "footer.backHome": "返回首页",
};
