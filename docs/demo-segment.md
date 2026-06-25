# CrewClaw · 演示环节导演脚本 (Demo Segment)

**时长目标:** ~2.5 分钟(落在 6 分钟 pitch 的第 5 页)
**弧线:** 招聘 → 立契 → 倍增 → 解雇 (Hire → Contract → Multiply → Fire)
**一句话目标:** 让评委记住——别人做 agent 工具，你做 agent 人才市场。

---

## 上台前 (Pre-flight) — 走上台之前全部就绪

- [ ] 终端已 `cd C:\Users\12117\Playground\crewclaw\crewhire`，字号 24pt，**已清屏**
- [ ] standup 的 brief **已复制到剪贴板**（别现场敲长句，粘贴即可）
- [ ] 浏览器已打开 `docs\showcase.html`，**放在第二个标签/桌面**（收尾时切过去）
- [ ] **场馆网络下已预热跑过一次 `crew standup`**（确认连通 + 暖缓存）
- [ ] 手机里存好 `docs\stage-fallback-standup.md` 截图（网断兜底）
- [ ] `--ascii` 心里有数（emoji 变方框时加）

---

## 节拍表 (Beat sheet)

| 时间 | 画面 | 你做什么 | 你说什么 |
|---|---|---|---|
| **0:00 冷开场** | 终端（空屏） | 敲 `crew hire macao-networking-agent` ⏎ | （不要自我介绍）"我不演示一个工具。我现场**招聘一位 AI 员工**——如果它不好用，我当场把它开了。" |
| **0:15 入职** | 4 行 ✓ 仪式动画 | 让它跑完 | "Employee Package 下载、技能安装、Manifest 校验……入职完成。20 秒，一位 ChaoGeek 认证的 AI 员工上岗。" |
| **0:35 立契（护城河）** | 敲 `crew badge macao-networking-agent` ⏎ → 员工工牌 | 指着卡片 | "这不是脚本，是它的**岗位说明书**——身份、技能、最小权限、SLA，还能被解雇。**没有 Manifest，Agent 只是工具；有 Manifest，Agent 才是员工。**" |
| **1:05 倍增（高光）** | 粘贴 brief ⏎ → 三栏并行泳道 | 粘贴 `crew standup "..."` ⏎ | "但一个员工不是一家公司。看我开个**晨会**——让整个团队同时干一件活。" |
| **1:15 并行进行中** | 3 条 spinner 并行跳动 (~6-8s) | 站住，让它跑 | "工程、产品、交际——三个员工，同一份简报，**同时**开工。" |
| **1:45 收敛** | Crew report + 2.9× + $0.04 | 指着数字 | "8 秒、4 美分，干完了三个人各自的活。串行要 20 秒，并行只要 6——**接近 3 倍**。这个数字每次都不一样，**因为它是真的，不是录像**。这不是 chatbot，是一支**并行的 AI 劳动力**。" |
| **2:00 解雇（按钮）** | 敲 `crew fire macao-networking-agent` ⏎ | 轻松一笑 | "雇佣、管理、解雇——一个真正的 **AI 人才市场**。" |
| **2:10 切画面** | **切到浏览器 `showcase.html` 全屏** | F11 / Alt+Tab | — |
| **2:20 收尾** | showcase 主页（hero + thesis） | 停在这一屏直到 Q&A | "别人做 agent 工具。**你雇一支 agent 员工队。** Don't install another tool — **hire your first AI employee.**" |

> standup 的 brief（剪贴板里放这句）：
> `It's launch morning at ClawCon — I pitch the judges in 1 hour. What should each of you do right now?`

---

## 故障分支 (Fallback branches) — 台上不慌

- **standup 卡住 / 网络死** → 45s 超时会让它红条干净退出（不冻屏）。立刻说："现场网络抖了，我放一段刚才预热的真实运行" → **切到 `showcase.html`**（页面里就是真实捕获的并行运行）。或退而求其次：`crew verify`（脚本化，永远能跑）"至少让团队自检一下代码能跑。"
- **emoji 变方框** → 任何命令加 `--ascii`。
- **评委追问"这是真的吗 / 它真能干活？"** → `crew run code-review-shrimp --input packages/runtime/run.mjs "review this file for merge readiness"` → 它会**当场真审出 run.mjs 的真实问题**（路径穿越 / 缺超时）。"你看，它在审我们自己今晚写的代码。"

---

## 弹性时长 (Flex)

- **90 秒极速版**：冷开场 → `hire` → `standup` → 切 showcase 收尾。（砍掉 badge + fire）
- **3 分钟完整版**：在"倍增"和"解雇"之间插入上面的 `crew run ... --input` 证明节拍。

---

## 这一段为什么有效

1. **先开枪再解释**：20 秒内命令行就动了，评委立刻知道"这人真做出来了"。
2. **护城河有一句可复述的话**："没有 Manifest 是工具，有 Manifest 才是员工。"
3. **高光是别人给不了的画面**：真实并行的 AI 劳动力 + 真实加速比 + 真实成本。
4. **有按钮**：`fire` 呼应开场玩笑，闭环。
5. **收尾是号召不是致谢**："Hire your first AI employee."
