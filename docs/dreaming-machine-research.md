# 做梦机器（Dreaming Machine）技术研究报告

> 2026-07-11 · 为 CrewClaw Dream 复盘机制立项做的深度调研。
> 结论先行：**"做梦"不是玄学，是一个已被行业命名的工程模式——异步记忆策展
> （asynchronous memory curation）**：利用空闲时间的模型推理，把积累的任务痕迹
> 蒸馏、去重、合并成对未来更有用的上下文。Anthropic 已把它做成 API 原语（2026-05），
> Letta 给了理论框架（sleep-time compute, 2025-04），失败模式与防御也有成体系的研究。
> CrewClaw 工作区里已有一个 per-task 版本的实现（`packages/runtime/dream.mjs`，未提交），
> 与研究结论高度吻合；真正缺的是**跨任务策展（batch dream）、逐条溯源、人工晋升门、
> 以及"两次评测分对比"的成长度量闭环**。

---

## 1. 术语正名：两条"做梦"脉络，别混

|             | RL 世界模型一脉（Dreamer）                                                      | Agent 记忆巩固一脉（Dreaming/Sleep-time）                                         |
| ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 代表        | Hafner 的 Dreamer/DreamerV3（"Mastering Diverse Domains through World Models"） | Letta sleep-time compute、Anthropic Claude Dreaming、Generative Agents reflection |
| "梦"是什么  | 在学到的**潜空间世界模型**里做想象 rollout，actor-critic 完全在想象轨迹上训练   | 离线读取**过往会话/任务日志**，重写记忆库（去重、合并、提炼模式）                 |
| 改变什么    | 模型权重（策略网络）                                                            | 可读记忆（上下文），**不改权重**                                                  |
| 适用前提    | 有可交互环境 + 可训练的世界模型                                                 | 有持久记忆库 + 任务痕迹                                                           |
| 对 CrewClaw | ❌ 不适用——数字员工没有可微世界模型，也不做权重训练                             | ✅ 完全对口——员工的"成长"就是记忆库质量的提升                                     |

DreamerV3 的价值是**名字的出处和隐喻**（在想象中学习、离线自我改进），工程上 CrewClaw
应该完整走第二脉。Letta 论文里有一句桥接两者的话：sleep-time compute 可视为
**offline policy improvement**——在空闲期用已收集的数据改进记忆表征，无需新的环境交互。

## 2. 行业实现对照（谁在什么时候做什么梦）

| 系统                                                                      | 梦的时机                                                       | 输入                                                   | 输出                                                                      | 关键设计                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Anthropic Claude Dreaming**（Managed Agents，2026-05 research preview） | 定时调度（用户配频率：每晚/每小时/自定义），**不在活跃会话中** | 现有 memory store + 最多 **100 个先前 session**        | **一个新的候选 memory store**（重组、合并重复、替换过期、浮现跨会话模式） | "memory 是写入层，dreaming 是策展层"；可选**人工审核后才生效**；改的是可读记忆不是权重                           |
| **Letta sleep-time compute**（arXiv:2504.13171，与 Ion Stoica 等合作）    | 主 agent 空闲期，频率可配（频率↔token 成本旋钮）               | 主 agent 的核心记忆块 + 会话历史 + 归档记忆 + 上传文档 | 优化后的记忆状态（anytime 更新）                                          | **双 agent 架构**：primary（快模型，无核心记忆写权）+ sleep agent（强模型，全记忆管理权）；AIME/GSM 上帕累托改进 |
| **小米 MiMo Code**                                                        | 每 **7 天**自动触发                                            | 积累的编码会话                                         | 更新的记忆                                                                | 行业采纳的旁证：梦是产品功能不是论文玩具                                                                         |
| **Generative Agents**（Park et al. 2023）                                 | 显著性累积触发（salience 阈值）                                | episodic 记忆流                                        | 高阶 reflection（递归总结成洞察）                                         | 记忆流 + 检索 + 反思三件套；证明长程一致行为靠记忆架构不靠底模                                                   |
| **Reflexion**（Shinn et al. 2023, NeurIPS）                               | **每次任务失败/结束后立即**（不是离线）                        | 环境反馈（标量/二值）+ 本轮轨迹                        | 自然语言反思，存 episodic buffer，下轮前置进上下文                        | "verbal reinforcement"：把反馈转成**语义梯度**；纯上下文、零权重更新                                             |
| **Voyager**（Wang et al. 2023）                                           | 任务成功后                                                     | 通过验证的解决方案代码                                 | 技能库新条目                                                              | **只存已验证成功的技能**——不存猜测，这是防污染的第一性原则                                                       |
| **MemGPT/Letta 记忆分层**                                                 | 持续                                                           | —                                                      | —                                                                         | OS 式层级：message buffer / core（上下文内可自编）/ recall（全历史可搜）/ archival（外部库）                     |

认知架构论文 CoALA（Sumers et al. 2023）给了记忆分类学：**episodic**（发生过什么）→
**semantic**（世界知识/事实）→ **procedural**（怎么做事/技能）。"做梦"本质上是把
episodic 往 semantic 和 procedural 蒸馏的那道工序。

## 3. 从实现里提炼的设计模式（共性规律）

1. **两层分工**：会话内记忆写入（write layer）和离线策展（curation layer）是两个过程。
   Reflexion 式的"任务后小反思"≠ Anthropic 式的"跨会话大梦"，成熟系统两个都有。
2. **候选制品，不是隐式突变**：梦的输出是一个**独立的候选记忆库/候选条目集**，
   可 diff、可审核、可回滚——绝不直接原地改写生效记忆（Anthropic 的 review-before-apply、
   Ken Huang 的 promotion workflow 都是这个原则）。
3. **只蒸馏被验证过的东西**：Voyager 只存成功技能；Reflexion 蒸馏的是**带环境反馈**的
   轨迹。没有外部验证信号的自由反思最容易沉淀幻觉。
4. **强模型做梦，快模型干活**：Letta 双 agent 的成本结构——梦不阻塞交互，可以慢、可以贵、
   可以深。
5. **频率是成本旋钮**：梦得越勤 token 烧得越多、上下文改进越大；MiMo 选 7 天，
   Anthropic 让用户自己配。
6. **梦也做减法**：合并重复、替换过期、解决矛盾——策展的一半价值在"忘"，
   否则记忆库单调膨胀直到污染检索。

## 4. 失败模式与防御（诚实性红线）

研究里反复出现的四类失败：

- **记忆投毒（memory poisoning）**：对抗者往记忆/知识库注入看似无害的记录操纵未来行为
  （AgentPoison）。梦会**放大**投毒——被污染的会话被蒸馏成"经验"后跨会话扩散。
- **自我强化错误环（self-reinforcing loops）**：错误结果被存成先例 → 之后更容易复现同错 →
  阈值越降越低（"Zombie Agents"：持久控制自进化 agent 的注入就是靠这个环存活）。
- **巩固期错误（consolidation errors）**：错置时序（corruption）、丢关键信息（omission）、
  引入无据陈述（hallucination）；反复摘要造成**语义漂移**，次优流程被固化成**程序漂移**；
  agent 过度信任自我反思，把局部经验蒸馏成过度泛化的高优先级规则（A-MemGuard 的核心观察）。
- **审计缺口**：梦在后台改共享记忆库，没有 diff/日志时无从追责。

对应防御（Ken Huang 的 dreaming 安全分析 + TRUSTMEM/SSGM 等）：

- **三库分层**：只读组织库（稳定标准）/ 只读项目库（已验证事实）/ 读写工作库（会话教训）。
  梦只能写工作库；晋升到只读库要走**显式审批**。
- **晋升门（review gate）**：候选记忆 → 人工/强验证 → 生效记忆，两态分离。
- **逐条溯源（provenance）**：每条记忆带来源 task/session id + 生成时间 + 生成模型，可追可撤。
- **限定输入批次**：梦读"策展过的批次"（如仅已验收任务），不是无差别读全历史。
- **把记忆库当安全边界**：与配置/策略同等的变更管控。

## 5. 怎么证明"做梦让员工变强"

行业通行做法 = **同一评测集上的前后分对比**（改的是记忆不是权重，所以评测必须绑定记忆状态）：

- Letta 论文：sleep-time compute 在 AIME/GSM 上相对 test-time-only 是帕累托改进
  （同 token 预算分更高 / 同分 token 更省）。
- 对 CrewClaw：`eval-runner` 已经能出真认证分（mock:false）。度量闭环 =
  **认证分绑定 (spec_version, judge model, memory_state_hash)**；
  梦一次 → 重跑 `pnpm eval:expert <slug>` → EVAL 屏展示两次分对比。
  这正是 prd_v0.18 §5 Phase 3 写的终点验收（"同员工两次真评测分对比可观测"）。
- 附带指标：记忆条数/去重率、召回注入 token 数（梦应当让注入**更短更准**而非更长）。

## 6. CrewClaw 现状盘点（工作区未提交实现，2026-07-11）

`packages/runtime/dream.mjs`（298 行，`crewclaw.dream/v1` 契约）+ run.mjs 接线已存在，
与上文研究结论对得很齐：

**已有（且方向正确）**

- 任务后小梦（Reflexion 式）：`reviewTaskRun({taskRun, deliverable, existingMemory, policy})`
  → 模型产出 `new_memory_candidates` + `new_playbook_candidates`（→ verified_sops）。
- 验证极严：6 类记忆白名单、字数/控制字节/键集校验、64KiB 响应上限。
- **staging-until-accept**：候选存在 `run.memory_commit{committed:false}`；
  只有交付物被用户验收（status=accepted）后 `commitAcceptedTaskMemory` 才落库，
  且要求与 accept 决策的**冻结快照 deep-equal**（防篡改）——这就是"只蒸馏被验证过的东西"。
- mock 永不种记忆；启发式 lessons 降级为运行警告（"长期记忆只能来自真实 Dream 模型响应"）。
- `shouldRecord` 丢弃 sensitive/low-confidence/ephemeral。

**缺口（按研究结论排序）**

1. **跨任务大梦（batch curation）没有**——现在只有 per-task 反思，没有"读全库+近 N 个
   已验收任务 → 产出候选新库（去重/合并/替换过期/浮现模式）"的策展层。记忆只增不减。
2. **逐条溯源没有**——候选条目只有 {category, text, confidence}，缺
   {source_task_ids, dreamed_at, model}，无法追责/撤销/审计。
3. **人工晋升门没有**——accept 交付物即自动 commit 记忆。对 per-task 小梦可接受
   （验收本身是门），但 batch 大梦改写全库必须走候选→diff→审批。
4. **成长度量闭环没有**——eval 报告不绑定 memory 状态，出不了"梦前梦后"对比。
5. TUI DREAM 屏仍是明示 MOCK（引擎有真事件 dream.completed/failed 可接）。

## 7. 建议：最小可行闭环（M 序）

边界宪章约束：梦在**引擎（Node）**发生；TUI 只做**预览与审批**（监督驾驶舱）；
候选制品落 `.crewclaw/`，绝不写 spec/SOUL。

- **M1 溯源与上限**（半天）：memory item 增加 `source_task_ids/dreamed_at/model` 字段；
  记忆库设 per-category 上限，超限先合并后淘汰。存量条目 backfill `source:"legacy"`。
- **M2 batch dream 命令**（1-2 天）：`crew dream <agent>`（或每 N 个已验收任务自动触发）：
  输入 = 现有记忆库 + 近 N 个**已验收** TaskRun（策展批次原则）；
  输出 = `.crewclaw/memory/<agent>/candidates/<ts>.json`（候选新库 + 结构化 diff：
  added/merged/replaced/dropped，每项带理由与溯源）。强模型、限 token 预算（接 spend.mjs）。
- **M3 晋升门**（1 天）：TUI DREAM 屏接真数据：展示候选 diff（预览级 UI，宪章内），
  `a` 采纳 → 候选库原子替换生效库（旧库存档可回滚）；`r` 丢弃。
  复用刚建好的 deliverable-acceptance approval 事件模式（approval.requested kind=dream_curation）。
- **M4 成长度量**（半天 + 一次评测费）：eval 报告写入 `memory_state_hash` 与条数；
  EVAL 屏并排展示最近两次真分。验收 = 对 crab：跑真评测 → 做几个任务 → dream → 再评测，
  两个分数可对比展示（当前 blocked：ZENMUX key 403，恢复后即可跑）。
- **不做**：夜间常驻调度（本地 CLI 无守护进程，按任务数触发即可）、双 agent 常驻
  sleep agent（成本不合本地形态）、自动晋升到只读库。

## 8. 来源

- [Letta — Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/)（论文 arXiv:2504.13171）
- [Letta — Agent Memory](https://www.letta.com/blog/agent-memory/)
- [Ken Huang — Why AI Agents Are Starting to Dream](https://kenhuangus.substack.com/p/why-ai-agents-are-starting-to-dream)
- [Ken Huang — Claude Agents Can Now Dream: 安全风险与防御](https://kenhuangus.substack.com/p/claude-agents-can-now-dream-how-ai)
- [MindStudio — What Is Claude Dreaming?](https://www.mindstudio.ai/blog/what-is-claude-dreaming-anthropic-managed-agents)
- [SiliconANGLE — Anthropic is letting Claude agents 'dream'](https://siliconangle.com/2026/05/06/anthropic-letting-claude-agents-dream-dont-sleep-job/)
- [DreamerV3 — Mastering Diverse Domains through World Models](https://ar5iv.labs.arxiv.org/html/2301.04104)（[GitHub](https://github.com/danijar/dreamerv3)）
- [Generative Agents: Interactive Simulacra of Human Behavior（Park et al. 2023）](https://www.researchgate.net/publication/375063078_Generative_Agents_Interactive_Simulacra_of_Human_Behavior)
- [Reflexion: Language Agents with Verbal Reinforcement Learning（Shinn et al. 2023）](https://arxiv.org/abs/2303.11366)
- [Cognitive Architectures for Language Agents（CoALA）](https://arxiv.org/pdf/2309.02427)
- [AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases](https://www.researchgate.net/publication/397214044_AgentPoison_Red-teaming_LLM_Agents_via_Poisoning_Memory_or_Knowledge_Bases)
- [Zombie Agents: Persistent Control of Self-Evolving LLM Agents via Self-Reinforcing Injections](https://arxiv.org/pdf/2602.15654)
- [A-MemGuard: A Proactive Defense Framework for LLM-Based Agent Memory](https://arxiv.org/pdf/2510.02373)
- [TRUSTMEM: Learning Trustworthy Memory Consolidation for LLM Agents](https://arxiv.org/pdf/2606.25161)
- [Sleep-Like Memory Consolidation in LLMs](https://www.emergentmind.com/papers/2605.26099)
- [Governing Evolving Memory in LLM Agents（SSGM）](https://arxiv.org/html/2603.11768v1)
