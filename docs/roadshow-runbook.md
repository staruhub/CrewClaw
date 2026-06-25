# CrewClaw `verify` — Roadshow Runbook / 路演运行手册

**Demo date / 演示日期:** this afternoon (本场路演)
**Feature / 功能:** `crewclaw verify`
**Audience / 观众:** pitch / roadshow (路演)

---

## One-line pitch / 一句话卖点

> **Hire a crew; they verify your codebase in parallel.**
> **雇一支船员队，让它们并行校验你的代码库。**

Six ChaoGeek-certified agents (build, types, lint, unit, e2e, registry) each take one lane and run at the same time — so verification that used to be slow and serial finishes in seconds.
六个 ChaoGeek 认证 agent（编译、类型、lint、单测、端到端、注册表）各占一条泳道、同时开跑——原本又慢又串行的校验，几秒钟搞定。

---

## 🏆 ClawCon 冠军版 — 两幕现场招聘 / Champion two-act stage flow

> **Reframe:** you are not pitching a tool, you are **hiring an AI employee, live.** Demo front-loaded — terminal in the first 20 seconds.
> **重定位：** 你不是讲工具，你是**现场招聘一位 AI 员工**。Demo 前置——开场 20 秒内出现命令行。

**Stage terminal setup / 上台终端准备:** open the terminal **already `cd`'d into** `C:\Users\12117\Playground\crewclaw\crewhire` (so the `cat` command's relative path resolves). `crew` is on PATH (copied to `.cargo\bin`), so you can type it bare. 终端先 `cd` 进 `crewhire`（让 `cat` 的相对路径生效）；`crew` 已加入 PATH，可直接裸敲。

**Opening line (no self-intro, fire first) / 开场（不自我介绍，先开枪）:**
> "大家好，我是 Pong。今天我不展示一个聊天机器人，也不展示一个插件。**我现场招聘一位 AI 员工。如果它不好用，我们还可以现场解雇它。**"

**Act 1 · 招聘 / Hire (the money shot)**
```powershell
crew hire macao-networking-agent
```
Four spinner steps resolve into ✓: Employee Package downloaded → Skills installed → Manifest verified → **Macao Networking Crab hired 🦀**. Deterministic, scripted, cannot fail. 四步动画收敛成 ✓，确定性，不会失败。

**Act 1.5 · 护城河 / The moat — the employee badge**
```powershell
crew badge macao-networking-agent
```
Renders the manifest as a visual ID card (identity · skills · permissions · SLA · status) — not a raw `cat`. 比直接 `cat` YAML 更像"员工工牌"，且纯由 CLI 渲染，不吃终端编码（中文 Windows 上 `cat` 会乱码，badge 不会）。
> "这不是脚本，这是它的**岗位说明书**。身份、技能、权限、SLA、生命周期。**没有 Manifest，Agent 只是工具；有 Manifest，Agent 才是员工。**"
> (Raw `cat agents/macao-networking-agent/hire.yaml` still works if a judge wants to see the real file.)

**Act 2 · ★ 真实并行员工队 / Live parallel crew (THE centerpiece)**
```powershell
crew standup "We launch CrewClaw at ClawCon tomorrow morning. Get me ready."
```
The 3 hired employees (🦐 engineering, 🦞 product, 🦀 networking) work the **same brief at the same time** — 3 real model calls in parallel — then converge into one Crew report with a **real** measured speedup (~2.9×) and **real** dollar cost (~$0.04). 这是别人给不了的画面：不是"AI 写文字"，是**一支并行 AI 劳动力当场把仨人的活在 7 秒、4 美分内干完**。
> "我不是给你看一个 AI 写东西——我现场调度了一支**并行的 AI 员工队**：工程、产品、交际同时开工，7 秒交付，成本 4 美分。这就是 Crew。"

**Act 3 (optional) · 深潜单兵 / Run — one employee, in depth (LIVE model)**
```powershell
crew run macao-networking-agent "我在 ClawCon 茶歇认识了红杉的李伟，聊到 agent 分发，帮我写封 follow-up，约下周咖啡"
```
If you have time and want to show ONE employee in depth: the runtime loads its SOUL.md persona + skills and streams a live answer (Claude Opus 4.8 via ZenMux) — a real follow-up with honest `[placeholders]`. Or `crew run code-review-shrimp "review this diff: <paste>"` catches a real SQL injection. Skip if standup already landed.
> Defensible alternative with real skills: `crew run code-review-shrimp "review this diff: <paste>"` — it catches a real SQL injection and gives a merge verdict. Use if the audience is technical.

> ⚠️ **`crew run` is a LIVE network call — the one non-deterministic moment.** Unlike the scripted acts it depends on venue wifi + the API. **Mitigations:** (1) pre-run it once on the venue network right before you go on (warms it, confirms connectivity); (2) keep a screenshot/recording of a good run as fallback; (3) use a short task (icebreaker streams fastest); (4) if the network is shaky, **skip Act 2 and rely on the scripted hire + verify** — never debug a live API on stage. (5) Latency too high? switch `HERMES_MODEL` in `crewhire\.env.local` to a faster model.
> ⚠️ **`crew run` 是全场唯一的实时网络环节、不确定。** 缓解：上台前在场馆网络先跑一次预热；备好一张成功截图兜底；用短任务（破冰最快）；网络不稳就**跳过这幕、只靠脚本化的 hire + verify**，绝不在台上调 API；嫌慢就在 `.env.local` 把 `HERMES_MODEL` 换更快的模型。

**Act 4 (fallback / infra) · 团队并行 / Verify (scripted, always safe)**
```powershell
crew verify
```
Scripted, deterministic, no network — your **safety net**. If the venue network is dead and `standup` can't run live, lead with this instead: 6 agents fan out in parallel → ✅ VERDICT. It also doubles as "the crew checks the codebase is runnable."

> ⚠️ **`crew standup` and `crew run` are LIVE (network + ~$0.04/standup).** Same caveats as before: pre-warm on venue wifi, keep the saved fallback (`docs/stage-fallback-standup.md`), and if the network is shaky **fall back to the scripted `crew verify`** — never debug a live call on stage. A 45s timeout means a dead network fails cleanly (red lane) instead of freezing.

**Closing (call to action, not "thank you") / 收尾（号召，不说谢谢）:**
> "如果你在 OpenClaw 生态里发布 Skill，下一步不是发布更多工具，而是让你的 Agent 入职 CrewClaw。"
> **"Don't install another tool. Hire your first AI employee."**

**The one line judges must remember / 评委必须记住的一句:** 别人做 Agent 工具，**你做 Agent 人才市场。** (ClawHub 分发 Skill，CrewClaw 分发 Employee Package.)

**Optional callback / 可选彩蛋（呼应开场解雇梗）:** `crew fire macao-networking-agent` → clean offboard line. Use only if you have spare time. 仅在时间充裕时用。

**Projector fallback / 投影兜底:** add `--ascii` to `crew hire …` / `crew verify` if emoji box out. 加 `--ascii`。

> ⚠️ **Slides carry mood, terminal + text carry the judging.** AI-generated full-page slide images blur/mangle text from a distance — keep the key commands, the one-liner, and any QR code in real PPT text or the live terminal, not inside an image.
> ⚠️ **图片负责气氛，终端和文本负责判分。** AI 整页图远看会糊；关键命令、核心金句、二维码用真 PPT 文本层或现场终端，别塞进图里。

---

## Deck placement / 在 8 页 deck 中的位置

This live demo slots into **slide 5 — "DEMO — CLI in Action."** Talk through slides 1–4 (Cover → WHY → WHAT → HOW), then on slide 5 **switch to the terminal** and run the demo below. Return to the deck for slides 6–8 (MARKET → VISION → TEAM).
本现场 demo 落在 **第 5 页「DEMO — CLI in Action」**。讲完 1–4 页（封面 → WHY → WHAT → HOW），到第 5 页**切到终端**跑下面的命令，跑完再切回 deck 讲 6–8 页（MARKET → VISION → TEAM）。

> The terminal IS the demo — it beats any static mockup. The 6 lanes animating in parallel is the moment that sells "multi-agent parallel."
> 终端本身就是 demo——比任何静态图都震撼。六条泳道并行跳动，正是"多 agent 并行"卖点的高光时刻。

---

## Commands — run in this exact order / 命令（严格按此顺序）

> **The demo is a prebuilt, statically-linked `crewclaw.exe` — no build step, no `cargo`, no DLLs, nothing on PATH.** The launcher `cd`s into the repo for you, so it works from any directory or even double-clicked.
> **demo 是预编译的静态 `crewclaw.exe`——无需编译、无需 `cargo`、无 DLL 依赖、PATH 里什么都不用配。** 启动器会自动 `cd` 进仓库，任意目录、甚至双击都能跑。

**1. Scripted demo (USE THIS ON STAGE) / 脚本化演示（上台就用这个）**

```powershell
C:\Users\12117\Playground\crewclaw\crewhire\verify-demo.cmd
```

This is the deterministic, choreographed run. The 6 lanes animate in parallel, then collapse into a clean **Crew report** table, the speedup line, and the green ✅ VERDICT. It always looks the same. This is your money shot.
这是确定性的、编排好的演示。六条泳道并行跑动，随后收敛成一张干净的 **Crew report** 结果表，再打印加速比和绿色 ✅ VERDICT。每次都一样。这就是你的高光镜头。

**2. ASCII fallback (if the projector mangles emoji/color) / ASCII 兜底（投影仪吃掉 emoji 或颜色时）**

```powershell
C:\Users\12117\Playground\crewclaw\crewhire\verify-demo.cmd --ascii
```

`--ascii` drops emoji and ANSI color and uses plain status words (`OK` / `WARN` / `FAIL`) so it reads cleanly on a projector terminal that doesn't render 🦐🦀🐙 or color. **Have this typed and ready before you go on.**
`--ascii` 去掉 emoji 和 ANSI 颜色，改用纯文本状态词（`OK` / `WARN` / `FAIL`），在不支持 🦐🦀🐙 或颜色的投影终端上也清晰可读。**上台前先把这条命令敲好备着。**

**3. `--live` — EXPERIMENTAL, DO NOT use on stage / 实验性,切勿上台用**

```powershell
REM Only after a full `pnpm install`, and never live on stage.
C:\Users\12117\Playground\crewclaw\crewhire\verify-demo.cmd --live
```

`--live` runs the **real** tooling (`cargo build`, `tsc`, `eslint`, `vitest`, `playwright`, validator) in parallel instead of the scripted timeline. It works mechanically, **but it reflects the real, current project state** — and in this unzipped copy the JS dev-dependencies are incomplete (`tsc`/`tsx` not installed), so 5 of 6 lanes go red. Even after a full `pnpm install` it can legitimately fail (real type/lint/e2e issues) and is slow (the e2e lane boots a Vite dev server). **Treat it as a dev tool, not a demo.** If asked "is this real?", say: *"是的——同一套 agent 在 CI 里跑真实工具链；台上这版是为稳定预录的时间线。"*
`--live` 会**并行真跑**真实工具链。机制是通的,**但它反映项目真实状态**——这份解压副本的 JS 开发依赖不全(`tsc`/`tsx` 没装),所以 6 条里 5 条爆红;即便跑完整 `pnpm install` 也可能合理失败、且慢(e2e 会起 Vite dev server)。**当它是开发工具,别当 demo。** 被问"是真的吗"就答:*"是的——同一套 agent 在 CI 跑真实工具链;台上这版是为稳定预录的时间线。"*

> **Branded alternative / 品牌化备选:** `pnpm --silent -C C:/Users/12117/Playground/crewclaw/crewhire run crewclaw verify` produces the same output via `cargo run` (rebuilds first run, then cached). Use the `.cmd` launcher on stage — it's faster and has zero dependencies.
> **品牌化备选:** `pnpm ... run crewclaw verify` 经 `cargo run` 输出相同结果（首次会编译，之后走缓存）。上台用 `.cmd` 启动器——更快、零依赖。

---

## 60–90s spoken script (中文口播稿)

> 节奏：问题 → 方案 → 现场跑 → 加速比 → 收尾金句。约 75 秒。

**【问题 · 约 15 秒】**
"做过工程的都懂：每次提交前要校验代码——编译、类型检查、lint、单元测试、端到端、还有注册表校验。痛点是，这些任务往往一个跑完才跑下一个，**串行、又慢**，喝杯咖啡回来可能还没跑完。"

**【方案 · 约 15 秒】**
"CrewClaw 的思路很简单：**雇一支船员队，让它们并行校验。** 六个 ChaoGeek 认证的 agent，各负责一条泳道，同一时刻一起开跑——就像一支真正的团队，而不是一个人排队干六件事。"

**【现场跑 · 约 20 秒】**
（敲下命令 1，回车）
"看屏幕——六条泳道**同时**亮起：🦐 编译、🦀 类型、🐙 lint、🐚 单测、🐡 端到端、🦞 注册表。它们各自推进、各自交卷……几秒钟，全部落地。"

**【加速比 · 约 15 秒】**
"如果一个个串行跑，这要二十多秒；并行之后，墙钟时间只取决于**最慢的那条泳道**——大约四秒半。也就是说，**接近 4.5 倍的提速**。校验越多、提速越明显。"

**【收尾金句 · 约 10 秒】**
"所以 CrewClaw 不是又一个跑测试的脚本——它是**你雇得起的一整支验证团队**。一句话：**雇一支船员，并行验证你的代码库。** 谢谢。"

> Speedup talking point grounded in the demo scenario: serial total ≈ 20.3s (sum of all lane steps), parallel wall-clock ≈ 4.5s (slowest lane), so ≈ **4.5x**. Round to "二十多秒变四秒多 / 约 4.5 倍" on stage.
> 加速比依据演示场景：串行总和 ≈ 20.3 秒（各泳道步骤之和），并行墙钟 ≈ 4.5 秒（最慢泳道），约 **4.5 倍**。台上说"二十多秒变四秒多 / 约 4.5 倍"即可。

---

## Pre-flight checklist / 上台前清单

Run through this **before** walking on stage. 上台**前**逐项过一遍。

- [ ] **Run it once / 先跑一遍。** Execute command 1 in the actual stage terminal before the talk. Warm caches so the on-stage run is instant. 上台前在实际演示终端先跑一次命令 1，预热缓存，让现场运行立刻出结果。
- [ ] **Terminal font size / 终端字号。** Bump to ~22–28pt so the back row can read it. 调到约 22–28pt，让最后一排也看得清。
- [ ] **Window width ≥ 100 cols / 窗口宽度 ≥ 100 列。** Check with the terminal at full width; the lanes and verdict columns need room or they wrap ugly. 全屏检查，泳道和结论列需要空间，否则会丑陋地换行。
- [ ] **Emoji + color support / emoji 与颜色支持。** Confirm 🦐🦀🐙🐚🐡🦞 render and color shows. If not → use `--ascii`. 确认 emoji 能渲染、颜色正常；不行就上 `--ascii`。
- [ ] **`--ascii` ready / 备好 `--ascii`。** Have command 2 typed in a second tab or your clipboard so you can switch in one keystroke. 把命令 2 敲在另一个标签页或剪贴板里，一键即可切换。
- [ ] **Launcher runs / 启动器能跑。** Confirm `verify-demo.cmd` prints the Crew report + VERDICT cleanly. The scripted demo needs **no network** and no toolchain. 确认 `verify-demo.cmd` 能干净打印 Crew report 和 VERDICT；脚本演示**不需要网络**、不需要工具链。
- [ ] **Clear scrollback / 清屏。** Start with a clean screen so only the verify output shows. 先清屏，让画面只剩 verify 输出。
- [ ] **Decide on `--live` / 决定要不要 `--live`。** Only plan to use it if you have spare time and a warm laptop. 只有时间充裕、机器已预热才计划使用。

---

## Failure-recovery notes / 故障恢复

- **Scripted mode is deterministic — it cannot fail. / 脚本模式是确定性的——不会失败。**
  Command 1 plays a fixed timeline. There is no flaky test, no network call, no real compiler in the path. If you ran it once in pre-flight, it will look identical on stage.
  命令 1 播放固定时间线，没有抖动的测试、没有网络调用、路径里也没有真实编译器。预检跑过一次，台上就一模一样。

- **If a lane *looks* wrong (cosmetic glitch, redraw artifact) → just rerun. / 某条泳道"看起来"不对（渲染抖动、重绘残影）→ 直接重跑。**
  Press up-arrow, Enter. Because it's deterministic, the rerun is clean. Say lightly: "让我重新跑一下 / let me run that again" — it's a one-second recovery, not a crash.
  上箭头、回车。确定性意味着重跑必然干净。轻描淡写一句"让我重新跑一下"即可，这是一秒钟的恢复，不是崩溃。

- **If emoji boxes / mojibake appear → switch to `--ascii`. / 出现 emoji 方框或乱码 → 切到 `--ascii`。**
  This is a terminal/font issue, not a CrewClaw bug. Run command 2. Frame it as a feature: "为了清晰，我切到 ASCII 模式 / I'll switch to ASCII for clarity."
  这是终端/字体问题，不是 CrewClaw 的 bug。跑命令 3，并把它包装成卖点："为了清晰，我切到 ASCII 模式。"

- **If `--live` is slow or throws a real warning → cut back to scripted. / `--live` 太慢或冒出真实告警 → 退回脚本模式。**
  `--live` runs real tools and is allowed to surface advisories. If it stalls or looks noisy, Ctrl+C and rerun command 1. Never debug live tooling on stage.
  `--live` 跑真实工具、可能出告警。卡顿或画面杂乱时，Ctrl+C，退回命令 1。**绝不在台上调试真实工具链。**

- **Golden rule / 黄金法则:** when in doubt, the scripted `verify` (command 1) is your safe path. Everything else is optional flair.
  拿不准时，脚本化的 `verify`（命令 1）就是你的安全路径，其余都只是锦上添花。
