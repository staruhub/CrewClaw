# CrewClaw 中文概念片脚本

- 目标时长：约 57 秒
- 画幅：16:9，1920 × 1080，30fps
- 语言：简体中文，无 TTS，画面内嵌功能字幕并附独立 SRT
- 视觉：原创未来场景、电影感运镜与确定性排版
- 渲染：Playwright 驱动概念片时间线，FFmpeg 输出 H.264 兼容文件

| 时间      | 概念画面             | 功能字幕重点                         |
| --------- | -------------------- | ------------------------------------ |
| 0–10.5s   | 未来 AI 人才市场     | 发现、检查并雇佣可管理的数字员工     |
| 10.5–21s  | AI 能力检查舱        | 能力、工具、价格、运行时与来源证据   |
| 21–31.5s  | 人类指挥 AI 团队协作 | 任务编排、并行协作、成本与交付汇总   |
| 31.5–42s  | 授权环与权限边界     | 权限门禁、全程审计、暂停与撤销       |
| 42–56.9s  | 一个人与一支 AI 团队 | 人始终拥有最终决定权，CrewClaw 收尾  |

渲染命令：`pnpm run video:demo`

可通过 `CREWCLAW_DEMO_OUT` 指定输出路径，通过 `CREWCLAW_DEMO_BROWSER` 指定 Chrome/Edge 可执行文件。默认输出到 `public/crewclaw-demo.zh-CN.mp4`。

原创概念帧保存在 [`assets/demo-concept`](assets/demo-concept)，作为可复现渲染的源素材。

字幕源文件：[`assets/crewclaw-demo.zh-CN.srt`](assets/crewclaw-demo.zh-CN.srt)
