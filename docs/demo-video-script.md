# CrewClaw 开源概念片发布说明

GitHub 首页与线上站点使用同一份发布母片：
[`public/crewclaw-demo.zh-CN.mp4`](../public/crewclaw-demo.zh-CN.mp4)。

- 时长：约 57 秒
- 画幅：1920 × 1080，30fps
- 编码：H.264 视频、无音轨、MP4 容器
- 语言：简体中文，核心信息直接写入画面
- 视觉：深色电影感场景、绿色终端配色、克制的品牌排版
- 叙事：检查员工包 → 人工审批 → 可追踪交付 → 当前开源边界

首页封面取自发布母片的 Beta 0.8 开源边界镜头。视频使用
`https://crewhire.fly.dev/crewclaw-demo.zh-CN.mp4` 作为稳定播放地址，避免 GitHub
把二进制文件链接展示成仓库目录页。

## 发布校验

运行 `pnpm run video:check` 会验证：

- 发布母片与封面的文件类型；
- 母片时长与审核通过版本的 SHA-256；
- README 是否仍指向稳定的线上播放地址。

`pnpm run build:web` 之后，母片必须出现在
`dist/public/crewclaw-demo.zh-CN.mp4`。

## 重新生成

[`scripts/render-demo-video.mjs`](../scripts/render-demo-video.mjs) 可通过
`pnpm run video:concept` 生成候选稿，但默认只写入
`artifacts/crewclaw-future-concept.zh-CN.mp4`，不会覆盖发布母片。
可通过 `CREWCLAW_DEMO_OUT` 指定其他候选输出路径。
