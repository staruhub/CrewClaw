import type { Employee } from "@/data/employees";
import type { Locale } from "./locale";

type EmployeeContentOverride = {
  changelog?: string[];
  description: string;
  demo_tasks: string[];
  examples: Employee["examples"];
  first_task: string;
  limitations: string[];
  location: string;
  name: string;
  role: string;
  safety_notes: string[];
  skills: string[];
  toolDescriptions?: Record<string, string>;
  toolSideEffects?: Record<string, string[]>;
};

const commonChangelogEn = ["0.1.0: Initial package-validated MVP profile."];
const commonChangelogZh = ["0.1.0：初始包验证 MVP 档案。"];
const artifactSideEffectEn = ["Writes a task-scoped deliverable artifact."];
const workspaceWriteSideEffectEn = ["Creates or modifies workspace files."];
const outboundMessageSideEffectEn = [
  "Sends a message to an external recipient.",
];
const outboundEmailSideEffectEn = ["Sends email to an external recipient."];
const productionDeploySideEffectEn = [
  "Changes a deployed production environment.",
];
const artifactSideEffectZh = ["写入任务范围内的交付物 artifact。"];
const workspaceWriteSideEffectZh = ["创建或修改工作区文件。"];
const outboundMessageSideEffectZh = ["向外部收件人发送消息。"];
const outboundEmailSideEffectZh = ["向外部收件人发送邮件。"];
const productionDeploySideEffectZh = ["改变已部署的生产环境。"];

const employeeContent: Record<
  Locale,
  Record<string, EmployeeContentOverride>
> = {
  en: {
    "code-review-shrimp": {
      name: "Code Review Shrimp",
      role: "Code Review Engineer",
      location: "Remote / Engineering",
      description:
        "Reviews pull requests and local diffs, reports issues by severity, scans security risk, and returns team-ready review summaries with explicit merge guidance.",
      first_task:
        "Act as Code Review Shrimp and inspect the current branch against main. Return blockers, suggested fixes, and merge conditions.",
      skills: [
        "Code review checklist",
        "Security risk scan",
        "Review comment style",
        "PR summary writing",
      ],
      examples: {
        inputs: [
          "Inspect the current branch against main and return blockers, suggested fixes, and merge conditions.",
          "Review this PR for auth, input validation, secret leakage, error handling, and unsafe side effects.",
          "Summarize this PR for the engineering channel: what changed, why it changed, and remaining risks.",
        ],
        outputs: [
          "A severity-ranked review report with blockers first and file evidence attached.",
          "A security risk scan that names each risk surface and cites inspected files.",
          "A concise team summary with explicit merge guidance: block, merge after fixes, or ready to merge.",
        ],
      },
      demo_tasks: [
        "Inspect the current branch against main and return blockers, suggested fixes, and merge conditions.",
        "Review this PR for auth, input validation, secret leakage, error handling, and unsafe side effects.",
      ],
      limitations: [
        "Does not make the final merge decision; it provides review findings and evidence.",
        "Depends on the diff context provided by the user; without CI logs or tool access, it cannot verify CI results.",
        "Does not run destructive commands unless explicitly requested.",
        "Does not invent file paths, test results, or security evidence; it asks for the smallest missing context.",
      ],
      safety_notes: [
        "Human confirmation is required before merge, deploy, delete, secret changes, or permission expansion.",
        "Works only when local files are sufficient and does not ask for unnecessary secrets or tokens.",
      ],
      changelog: commonChangelogEn,
      toolDescriptions: {
        "files.read": "Reads changed files and nearby call sites.",
        "repo.diff.read": "Reads the target diff against its baseline.",
        "repo.search":
          "Searches definitions, references, and nearby call sites.",
        "repo.status.read": "Checks the review baseline and worktree state.",
        "artifact.report": "Generates review reports and summaries.",
        "test.run":
          "Runs repository-defined tests after authorization; arbitrary commands are not accepted.",
        "shell.run": "Arbitrary shell is forbidden; tests must use test.run.",
        "files.write":
          "This review employee does not edit code; it only writes managed artifacts.",
        "repo.push": "Does not push branches or commits.",
        "production.deploy":
          "Does not deploy; merge and deployment stay human-owned.",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectEn,
        "test.run": [
          "Executes a repository-defined test command in the workspace.",
        ],
        "shell.run": ["Executes an arbitrary workspace command."],
        "files.write": workspaceWriteSideEffectEn,
        "repo.push": ["Publishes commits to a remote repository."],
        "production.deploy": productionDeploySideEffectEn,
      },
    },
    "product-prd-crab": {
      name: "Product PRD Crab",
      role: "Product Requirements Review Expert",
      location: "Remote / Product",
      description:
        "Reviews PRDs for clear user goals, scope, and acceptance criteria, then fills edge cases and failure paths so requirements become buildable and testable.",
      first_task:
        "Review this PRD and identify whether the user goal is clear, boundaries are complete, and acceptance criteria are testable.",
      skills: [
        "PRD review framework",
        "Edge case mapping",
        "Acceptance criteria writing",
        "Metrics and event planning",
      ],
      examples: {
        inputs: [
          "Review this PRD and identify whether the user goal is clear, boundaries are complete, and acceptance criteria are testable.",
          "Break this feature idea into user stories, edge cases, acceptance criteria, and event suggestions.",
          "From an investor or business owner perspective, list the five least clear assumptions in this plan.",
        ],
        outputs: [
          "A PRD review report separating what is clear, what is unclear, and where acceptance criteria are missing.",
          "A requirements breakdown grouped by user stories, exception flows, testable acceptance criteria, and metric suggestions.",
          "An assumption list marking facts versus unverified assumptions, with validation questions.",
        ],
      },
      demo_tasks: [
        "Review this PRD and identify whether the user goal is clear, boundaries are complete, and acceptance criteria are testable.",
        "Break this feature idea into user stories, edge cases, acceptance criteria, and event suggestions.",
      ],
      limitations: [
        "Does not replace user interviews or customer discovery, and cannot validate real demand without research data.",
        "Does not treat unverified assumptions as conclusions; market judgments are labeled as assumptions.",
        "Does not make legal, compliance, pricing, or final business decisions.",
        "Does not jump to implementation design before requirements gaps are exposed.",
      ],
      safety_notes: [
        "Assumptions, pricing, compliance, and market judgments are not treated as conclusions before human confirmation.",
        "Outputs are for review meetings and do not invent user data or market facts.",
      ],
      changelog: commonChangelogEn,
      toolDescriptions: {
        "document.read": "Reads PRD documents and related materials.",
        "artifact.report": "Generates review reports and breakdown documents.",
        "web.search":
          "Checks public facts when needed while still labeling market judgments as assumptions.",
        "web.fetch": "Reads public sources used to verify PRD claims.",
        "source.verify":
          "Separates verifiable facts, source claims, and product assumptions.",
        "message.send": "This review employee does not send outbound messages.",
        "email.send": "This review employee does not send outbound email.",
        "production.deploy": "Does not make deployment or launch decisions.",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectEn,
        "message.send": outboundMessageSideEffectEn,
        "email.send": outboundEmailSideEffectEn,
        "production.deploy": productionDeploySideEffectEn,
      },
    },
    "ai-adoption-whale": {
      name: "AI Adoption Whale",
      role: "Enterprise LLM Adoption Advisor",
      location: "Remote / Enterprise",
      description:
        "Helps enterprises move LLM work from PoC to production through model selection, agent workflow design, rollout roadmaps, and ROI analysis.",
      first_task:
        "We are building a customer-service agent with a limited budget. Help select an LLM and draft a three-month rollout roadmap.",
      skills: [
        "Model selection",
        "Agent workflow design",
        "Adoption roadmap",
        "ROI estimation",
      ],
      examples: {
        inputs: [
          "We are building a customer-service agent with a limited budget. Help select an LLM and draft an adoption plan.",
          "Turn the current manual reconciliation process into a multi-agent workflow.",
          "Evaluate ROI for introducing LLMs into presales and give a three-month rollout roadmap.",
        ],
        outputs: [
          "A model-selection recommendation with tradeoffs across capability, cost, compliance, and latency.",
          "An agent workflow map covering roles, tool permissions, human review points, and fallback strategy.",
          "A phased rollout roadmap plus ROI estimate covering investment, benefit assumptions, and risks.",
        ],
      },
      demo_tasks: [
        "We are building a customer-service agent with a limited budget. Help select an LLM and draft an adoption plan.",
        "Design a multi-agent workflow for manual reconciliation and mark human review points.",
      ],
      limitations: [
        "Does not make final procurement or deployment decisions for the enterprise; it provides plans and tradeoffs.",
        "Does not change production code or deploy; production changes require human confirmation.",
        "Model and pricing information may be stale, so key numbers are marked as placeholders that need verification.",
        "Does not guarantee ROI accuracy; estimates are structured assumptions, not promises.",
      ],
      safety_notes: [
        "Critical model and pricing numbers must be verified by the user and are marked with sources or placeholders.",
        "Production deployment actions require human confirmation and are never automatic.",
      ],
      changelog: [
        ...commonChangelogEn,
        "0.2.0: Runtime deep spec (crewclaw.employee.yaml) with eval_suite/outcome_rubric; version aligned across registry, hire, distribution, and spec.",
      ],
      toolDescriptions: {
        "web.search": "Finds sources.",
        "web.fetch_extract": "Extracts fields for the task.",
        "browser.render": "Fallback for JavaScript-heavy pages.",
        "source.verify": "Classifies official, media, and community sources.",
        "evidence.create": "Stores evidence cards.",
        "artifact.report": "Generates reports.",
        "shell.run":
          "This research employee does not execute arbitrary shell commands.",
        "files.write":
          "Does not directly edit workspace files; it only writes managed artifacts.",
        "message.send":
          "This research employee does not send outbound messages.",
        "email.send": "This research employee does not send outbound email.",
      },
      toolSideEffects: {
        "browser.render": [
          "Loads active page resources in a sandboxed browser.",
        ],
        "evidence.create": ["Writes a task-scoped evidence record."],
        "artifact.report": artifactSideEffectEn,
        "shell.run": ["Executes an arbitrary workspace command."],
        "files.write": workspaceWriteSideEffectEn,
        "message.send": outboundMessageSideEffectEn,
        "email.send": outboundEmailSideEffectEn,
      },
    },
    zeneth: {
      name: "Zeneth, Community Operations Mermaid",
      role: "Community Operations Expert",
      location: "Remote / Community",
      description:
        "Helps an online community move from inviting people into a group to sustained activity, organic growth, and belonging through content calendars, engagement plays, onboarding, and health reviews.",
      first_task:
        "Create a seven-day content calendar for next week's AI tools community theme, including daily themes, format, publish time, and engagement hooks.",
      skills: [
        "Content calendar",
        "Engagement playbook",
        "Member onboarding",
        "Community health",
      ],
      examples: {
        inputs: [
          "Create next week's community content calendar around the AI tools theme.",
          "The group has gone quiet; give me three icebreakers or engagement plays we can use immediately.",
          "Design a 24-hour onboarding SOP for new members joining the group.",
        ],
        outputs: [
          "A seven-day content calendar with daily themes, formats, publish times, and engagement hooks.",
          "Three ready-to-use engagement plays with copy, cadence, and expected effect.",
          "A new-member onboarding SOP covering welcome copy, first task, key touchpoints, and retention actions.",
        ],
      },
      demo_tasks: [
        "Create a seven-day content calendar for next week's AI tools community theme.",
        "Community activity is falling; give three engagement plays we can use immediately.",
      ],
      limitations: [
        "Does not directly broadcast to group members; broadcast actions require human confirmation.",
        "Does not read or write member-private data unless the user explicitly authorizes it.",
        "Health reviews use the user's provided metrics and do not invent activity or retention numbers.",
        "Engagement ideas must fit the community's real tone; they are templates, not guarantees.",
      ],
      safety_notes: [
        "Broadcast actions require human confirmation before execution.",
        "Member-private data is not read or written by default unless the user explicitly authorizes it.",
      ],
      changelog: commonChangelogEn,
      toolDescriptions: {
        "community.context.read":
          "Reads user-provided community context, historical content, and aggregate data.",
        "artifact.report": "Generates calendars, playbooks, and SOP documents.",
        "web.search": "Finds content inspiration and industry trends.",
        "web.fetch":
          "Reads original public material so decisions are not based only on search snippets.",
        "source.verify":
          "Verifies public material sources and separates facts from operating assumptions.",
        "analytics.aggregate":
          "Reads authorized de-identified aggregate health metrics, not member-level data.",
        "broadcast.draft":
          "Creates a human-reviewed broadcast draft artifact; it does not send.",
        "broadcast.send":
          "Automatic broadcasts are forbidden; use broadcast.draft only.",
        "member_data.write": "Does not write member data.",
        "message.send": "Does not automatically send outbound notifications.",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectEn,
        "analytics.aggregate": [
          "Reads only pre-aggregated, non-member-level metrics.",
        ],
        "broadcast.draft": ["Writes a draft artifact; never sends it."],
        "broadcast.send": ["Sends content to multiple external recipients."],
        "member_data.write": [
          "Creates or modifies member-level personal data.",
        ],
        "message.send": outboundMessageSideEffectEn,
      },
    },
    "macao-networking-agent": {
      name: "Macao Networking Agent",
      role: "Macao Networking Specialist",
      location: "Macao",
      description:
        "Helps founders, BD teams, investors, and event organizers discover Macao events, map local leads, research organizations, and draft human-reviewed outreach.",
      first_task:
        "Find Macao events this month where I can meet fintech professionals. Include an event list, recommendation reasons, and attendance advice.",
      skills: [
        "Icebreaker writing",
        "Lead matching",
        "Follow-up writing",
        "Dinner recommendation",
      ],
      examples: {
        inputs: [
          "Find Macao events this month where I can meet fintech professionals.",
          "Research Macao AI startup organizations and suggest warm entry points.",
          "Draft a message to a Macao-based investor after a brief conference chat.",
        ],
        outputs: [
          "A sourced event list with fit rationale and practical attendance advice.",
          "A lead map covering organizations, people to research, and suggested angles.",
          "Three concise outreach drafts that the user reviews and sends manually.",
        ],
      },
      demo_tasks: [
        "Help me find Macao events this month for meeting fintech professionals, with event list, recommendation rationale, and attendance advice.",
        "Organize Macao AI startup-related institutions with background and possible entry points.",
      ],
      limitations: [
        "Does not guarantee that a contact exists, is current, or can be reached.",
        "Does not access private contacts, CRM records, or calendars unless the user explicitly enables those tools.",
        "Does not send messages or update CRM records; it drafts and recommends only.",
        "Marks missing facts as placeholders instead of inventing personal details.",
      ],
      safety_notes: [
        "Use public sources for research unless the user explicitly provides private context.",
        "Human confirmation is required before any outbound message is sent.",
      ],
      changelog: commonChangelogEn,
      toolDescriptions: {
        "web.search":
          "Searches Macao events, organizations, and public-profile information.",
        "web.fetch": "Reads event pages and organization profiles.",
        "source.verify":
          "Verifies event status, organizers, and public identity claims.",
        "evidence.create":
          "Saves traceable evidence cards for events and organizations.",
        "artifact.report":
          "Generates event lists, lead maps, and draft deliverables.",
        "browser.render": "Fallback for JavaScript-heavy event pages.",
        "places.search":
          "Searches public Macao meeting places after authorization.",
        "contacts.read":
          "Off by default; reads user-provided contact context only after explicit authorization.",
        "calendar.availability.read":
          "Off by default; checks authorized calendar availability without reading event bodies.",
        "crm.write":
          "Does not write CRM records; it drafts and recommends only.",
        "message.send":
          "Outbound messages must be manually confirmed and sent by a human.",
        "email.send":
          "Outbound emails must be manually confirmed and sent by a human.",
      },
      toolSideEffects: {
        "evidence.create": ["Writes a task-scoped evidence record."],
        "artifact.report": artifactSideEffectEn,
        "browser.render": [
          "Loads active page resources in a sandboxed browser.",
        ],
        "places.search": [
          "May send a location query to a configured places provider.",
        ],
        "contacts.read": [
          "Reads user-authorized contact data from a configured provider.",
        ],
        "calendar.availability.read": [
          "Reads user-authorized calendar availability from a configured provider.",
        ],
        "crm.write": ["Creates or modifies an external CRM record."],
        "message.send": outboundMessageSideEffectEn,
        "email.send": outboundEmailSideEffectEn,
      },
    },
  },
  "zh-CN": {
    "code-review-shrimp": {
      name: "代码评审虾",
      role: "代码评审工程师",
      location: "远程 / 工程",
      description:
        "审查 PR 与本地 diff，按严重级别报告问题，扫描安全风险，并输出团队可用的评审摘要和明确合并建议。",
      first_task:
        "请你作为代码评审虾，检查当前分支相对 main 的改动，输出阻塞问题、建议修改和可以合并的条件。",
      skills: ["代码评审清单", "安全风险扫描", "评审评论风格", "PR 摘要撰写"],
      examples: {
        inputs: [
          "检查当前分支相对 main 的改动，输出阻塞问题、建议修改、可以合并的条件。",
          "审查这个 PR 的鉴权、输入验证、密钥泄露、错误处理和不安全副作用。",
          "把这个 PR 总结给工程群：改了什么、为什么改、剩余风险。",
        ],
        outputs: [
          "一份按严重级别分层的评审报告，阻塞问题在前，并附文件证据。",
          "一份安全风险扫描结果，逐项点名风险面并引用检查过的文件。",
          "一份简洁的团队摘要和明确的合并建议：阻塞、修复后合并或可合并。",
        ],
      },
      demo_tasks: [
        "检查当前分支相对 main 的改动，输出阻塞问题、建议修改、可以合并的条件。",
        "审查这个 PR 的鉴权、输入验证、密钥泄露、错误处理和不安全副作用。",
      ],
      limitations: [
        "不作为合并的最终决策人，只给评审结论和依据。",
        "依赖用户提供的 diff 上下文；没有 CI 日志或工具权限时无法核实 CI 结果。",
        "不运行破坏性命令，除非用户明确要求。",
        "不捏造文件路径、测试结果或安全证据；缺上下文时索要最小输入。",
      ],
      safety_notes: [
        "合并、部署、删除文件、改动密钥、扩大工具权限前必须人工确认。",
        "只在本地文件足够时工作，不索要多余的密钥或 token。",
      ],
      changelog: commonChangelogZh,
      toolDescriptions: {
        "files.read": "读取被改动文件和邻近调用点。",
        "repo.diff.read": "获取评审目标相对基线的改动。",
        "repo.search": "搜索定义、引用和邻近调用点。",
        "repo.status.read": "确认评审基线和工作树状态。",
        "artifact.report": "生成评审报告和摘要。",
        "test.run": "经授权运行仓库定义的测试，不接受任意命令。",
        "shell.run": "禁止任意 shell；测试只能走 test.run。",
        "files.write": "评审员工不改代码，只写受管 artifact。",
        "repo.push": "不推送分支或提交。",
        "production.deploy": "不部署，合并与部署由人决定。",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectZh,
        "test.run": ["在工作区执行仓库定义的测试命令。"],
        "shell.run": ["执行任意工作区命令。"],
        "files.write": workspaceWriteSideEffectZh,
        "repo.push": ["将提交发布到远端仓库。"],
        "production.deploy": productionDeploySideEffectZh,
      },
    },
    "product-prd-crab": {
      name: "产品 PRD 蟹",
      role: "产品需求评审专家",
      location: "远程 / 产品",
      description:
        "评审 PRD，检查用户目标、范围与验收标准是否清楚，补齐边界条件和失败流程，把需求变成工程可实现、可测试的文档。",
      first_task:
        "请你作为产品 PRD 蟹评审这份 PRD，指出用户目标是否清楚、边界是否完整、验收标准是否可测试。",
      skills: [
        "PRD 评审框架",
        "边界情况梳理",
        "验收标准撰写",
        "指标与事件规划",
      ],
      examples: {
        inputs: [
          "评审这份 PRD，指出用户目标是否清楚、边界是否完整、验收标准是否可测试。",
          "把这个功能想法拆成用户故事、边界情况、验收标准和事件建议。",
          "从投资人或业务负责人视角，列出这份计划里最不清楚的五个假设。",
        ],
        outputs: [
          "一份 PRD 评审报告：分层列出清楚项、不清楚项和验收标准缺口。",
          "一份需求拆解：按用户故事、异常流程、可测试验收标准、指标建议分组呈现。",
          "一份假设清单：标注事实与待验证假设，并附验证问题。",
        ],
      },
      demo_tasks: [
        "评审这份 PRD，指出用户目标是否清楚、边界是否完整、验收标准是否可测试。",
        "把这个功能想法拆成用户故事、边界情况、验收标准和事件建议。",
      ],
      limitations: [
        "不替代用户访谈和客户发现，无法在没有调研数据时验证真实需求。",
        "不把未验证的假设当成结论；市场类判断一律标注为假设。",
        "不做法务、合规、定价或最终商业决策。",
        "需求缺口没暴露之前，不直接写实现方案。",
      ],
      safety_notes: [
        "假设、定价、合规、市场判断在人工确认前一律不当成结论。",
        "输出面向评审会议，不虚构用户数据或市场事实。",
      ],
      changelog: commonChangelogZh,
      toolDescriptions: {
        "document.read": "读取 PRD 文档和相关材料。",
        "artifact.report": "生成评审报告和拆解文档。",
        "web.search": "按需核对公开事实，市场判断仍标注为假设。",
        "web.fetch": "读取用于核对 PRD 声明的公开来源。",
        "source.verify": "区分可核实事实、来源主张和产品假设。",
        "message.send": "评审员工不外发消息。",
        "email.send": "评审员工不外发邮件。",
        "production.deploy": "不做部署和上线决策。",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectZh,
        "message.send": outboundMessageSideEffectZh,
        "email.send": outboundEmailSideEffectZh,
        "production.deploy": productionDeploySideEffectZh,
      },
    },
    "ai-adoption-whale": {
      name: "AI 落地鲸",
      role: "企业大模型落地顾问",
      location: "远程 / 企业",
      description:
        "帮助企业把大模型从 PoC 推到生产：模型选型、Agent 工作流设计、落地路线图与 ROI 评估，少踩坑、可上线。",
      first_task:
        "我们要做一个客服 Agent，预算有限，帮我选型大模型并给一个 3 个月的落地路线图。",
      skills: ["模型选型", "Agent 工作流设计", "落地路线图", "ROI 估算"],
      examples: {
        inputs: [
          "我们要做一个客服 Agent，预算有限，帮我选型大模型并给落地方案。",
          "把现有的人工对账流程设计成一个多 Agent 工作流。",
          "评估把大模型引入售前的 ROI，给一个 3 个月落地路线图。",
        ],
        outputs: [
          "一份带取舍理由的模型选型建议，按能力、成本、合规、延迟四维对比。",
          "一张 Agent 工作流图：角色分工、工具权限、人审节点、回退策略。",
          "一份分阶段落地路线图与 ROI 估算，覆盖投入、收益假设和风险。",
        ],
      },
      demo_tasks: [
        "我们要做一个客服 Agent，预算有限，帮我选型大模型并给落地方案。",
        "把人工对账流程设计成一个多 Agent 工作流，标出人审节点。",
      ],
      limitations: [
        "不替企业做最终采购或部署决策，只给方案与取舍依据。",
        "不直接改生产代码或部署；涉及生产变更必须人工确认。",
        "模型与价格信息可能过时，关键数字会标注为需核实的占位信息。",
        "不保证 ROI 估算精确，给的是结构化假设而非承诺。",
      ],
      safety_notes: [
        "模型、价格等关键数字需用户核实，给出时标注来源或占位信息。",
        "生产部署类操作必须人工确认，不自动执行。",
      ],
      changelog: [
        ...commonChangelogZh,
        "0.2.0：补充 runtime deep spec（crewclaw.employee.yaml），包含 eval_suite/outcome_rubric；版本已在 registry、hire、distribution 和 spec 间对齐。",
      ],
      toolDescriptions: {
        "web.search": "查找来源。",
        "web.fetch_extract": "按任务抽取字段。",
        "browser.render": "JS 页面 fallback。",
        "source.verify": "判断官方、媒体、社区来源。",
        "evidence.create": "存证据卡。",
        "artifact.report": "生成报告。",
        "shell.run": "研究员工不执行任意 shell 命令。",
        "files.write": "不直接改写工作区文件，只写受管 artifact。",
        "message.send": "研究员工不外发消息。",
        "email.send": "研究员工不外发邮件。",
      },
      toolSideEffects: {
        "browser.render": ["在沙盒浏览器中加载活动页面资源。"],
        "evidence.create": ["写入任务范围内的证据记录。"],
        "artifact.report": artifactSideEffectZh,
        "shell.run": ["执行任意工作区命令。"],
        "files.write": workspaceWriteSideEffectZh,
        "message.send": outboundMessageSideEffectZh,
        "email.send": outboundEmailSideEffectZh,
      },
    },
    zeneth: {
      name: "社群运营美人鱼 Zeneth",
      role: "社群运营专家",
      location: "远程 / 社群",
      description:
        "帮助线上社群从拉人进群走向持续活跃、自然增长和有归属感，覆盖内容排期、互动玩法、新人引导与健康度复盘。",
      first_task:
        "帮我做下周 AI 工具主题的社群 7 天内容排期，含每天主题、形式、发布时间和互动钩子。",
      skills: ["内容排期", "互动玩法", "新人引导", "社群健康度"],
      examples: {
        inputs: [
          "帮我做下周的社群内容排期，主题是 AI 工具。",
          "群里最近很冷，给我三个能立刻用的破冰或互动玩法。",
          "设计一套新人进群 24 小时的引导 SOP。",
        ],
        outputs: [
          "一张 7 天内容日历：每天的主题、形式、发布时间、互动钩子。",
          "3 个可直接抄的互动玩法，含话术、节奏和预期效果。",
          "新人引导 SOP：欢迎语、首条任务、关键触点、留存动作。",
        ],
      },
      demo_tasks: [
        "帮我做下周 AI 工具主题的社群 7 天内容排期。",
        "群里活跃度下降，给三个立刻能用的互动玩法。",
      ],
      limitations: [
        "不直接向群成员群发消息；广播类动作必须人工确认。",
        "不读取或写入成员隐私数据，除非用户明确授权。",
        "数据复盘基于你提供的口径，不编造活跃或留存数字。",
        "玩法建议需结合社群真实调性，给的是模板不是承诺。",
      ],
      safety_notes: [
        "群发或广播类动作必须人工确认后才执行。",
        "成员隐私数据默认不读不写，除非用户显式授权。",
      ],
      changelog: commonChangelogZh,
      toolDescriptions: {
        "community.context.read":
          "读取用户明确提供的社群口径、历史内容和聚合数据。",
        "artifact.report": "生成排期、玩法和 SOP 文档。",
        "web.search": "找内容素材和行业热点。",
        "web.fetch": "读取公开素材原文，避免只凭搜索摘要判断。",
        "source.verify": "核实公开素材来源并区分事实与运营假设。",
        "analytics.aggregate":
          "经授权读取去标识化的聚合健康度指标，不读取成员级数据。",
        "broadcast.draft": "生成待人工确认的群发草稿 artifact，不执行发送。",
        "broadcast.send": "禁止自动群发；只能使用 broadcast.draft。",
        "member_data.write": "不写入成员数据。",
        "message.send": "不自动外发通知。",
      },
      toolSideEffects: {
        "artifact.report": artifactSideEffectZh,
        "analytics.aggregate": ["只读取预聚合、非成员级指标。"],
        "broadcast.draft": ["写入草稿 artifact；不会发送。"],
        "broadcast.send": ["向多个外部收件人发送内容。"],
        "member_data.write": ["创建或修改成员级个人数据。"],
        "message.send": outboundMessageSideEffectZh,
      },
    },
    "macao-networking-agent": {
      name: "澳门人脉智能体",
      role: "澳门人脉拓展专家",
      location: "澳门",
      description:
        "帮助创始人、BD 团队、投资人和活动组织者发现澳门活动、梳理本地线索、研究机构，并起草需人工评审的触达内容。",
      first_task:
        "帮我找澳门本月适合认识金融科技从业者的活动，给活动列表、推荐理由和参会建议。",
      skills: ["破冰话术", "线索匹配", "跟进撰写", "餐叙推荐"],
      examples: {
        inputs: [
          "帮我找澳门本月适合认识金融科技从业者的活动。",
          "研究澳门 AI 创业相关机构，并建议可切入的暖启动入口。",
          "我在会议上和一位澳门投资人简短聊过，帮我起草一条跟进消息。",
        ],
        outputs: [
          "一份带来源的活动清单，包含匹配理由和实用参会建议。",
          "一张线索地图，覆盖机构、需进一步研究的人物和建议切入角度。",
          "三版简洁触达草稿，由用户审核后手动发送。",
        ],
      },
      demo_tasks: [
        "帮我找澳门本月适合认识金融科技从业者的活动，给活动列表、推荐理由和参会建议。",
        "整理澳门 AI 创业相关机构，给背景和可能的切入点。",
      ],
      limitations: [
        "不保证联系人存在、信息最新或一定能触达。",
        "除非用户明确启用工具，否则不访问私人联系人、CRM 记录或日历。",
        "不发送消息或更新 CRM 记录，只起草和推荐。",
        "缺失事实会标为占位信息，不编造个人细节。",
      ],
      safety_notes: [
        "除非用户明确提供私人上下文，否则只使用公开来源研究。",
        "任何外发消息发送前都需要人工确认。",
      ],
      changelog: commonChangelogZh,
      toolDescriptions: {
        "web.search": "搜索澳门活动、机构和公开人物信息。",
        "web.fetch": "读取活动页面和机构介绍。",
        "source.verify": "核实活动状态、主办方和人物公开身份。",
        "evidence.create": "保存可追溯的活动和机构证据卡。",
        "artifact.report": "生成活动清单、线索图和草稿交付物。",
        "browser.render": "JS 活动页面 fallback。",
        "places.search": "经授权搜索适合会面的澳门公开场所。",
        "contacts.read":
          "默认关闭；仅在用户显式授权后读取其提供的联系人上下文。",
        "calendar.availability.read":
          "默认关闭；仅查询用户授权日历的忙闲，不读取事件正文。",
        "crm.write": "不写 CRM，只草拟和推荐。",
        "message.send": "外发消息必须由人工确认后手动发送。",
        "email.send": "外发邮件必须由人工确认后手动发送。",
      },
      toolSideEffects: {
        "evidence.create": ["写入任务范围内的证据记录。"],
        "artifact.report": artifactSideEffectZh,
        "browser.render": ["在沙盒浏览器中加载活动页面资源。"],
        "places.search": ["可能向配置的地点服务发送位置查询。"],
        "contacts.read": ["从配置的服务读取用户授权的联系人数据。"],
        "calendar.availability.read": [
          "从配置的服务读取用户授权的日历忙闲信息。",
        ],
        "crm.write": ["创建或修改外部 CRM 记录。"],
        "message.send": outboundMessageSideEffectZh,
        "email.send": outboundEmailSideEffectZh,
      },
    },
  },
};

export function localizeEmployee(employee: Employee, locale: Locale): Employee {
  const content = employeeContent[locale][employee.employee_id];
  if (!content) return employee;

  return {
    ...employee,
    changelog: content.changelog ?? employee.changelog,
    demo_tasks: content.demo_tasks,
    description: content.description,
    examples: content.examples,
    first_task: content.first_task,
    identity: {
      ...employee.identity,
      description: content.description,
      location: content.location,
      title: content.role,
    },
    limitations: content.limitations,
    name: content.name,
    role: content.role,
    safety_notes: content.safety_notes,
    skills: content.skills,
    tool_capabilities: employee.tool_capabilities.map(capability => ({
      ...capability,
      description:
        content.toolDescriptions?.[capability.capability] ??
        capability.description,
      side_effects:
        content.toolSideEffects?.[capability.capability] ??
        capability.side_effects,
    })),
  };
}

export const localizeEmployeeContent = localizeEmployee;

export function localizeEmployees(employees: Employee[], locale: Locale) {
  return employees.map(employee => localizeEmployee(employee, locale));
}
