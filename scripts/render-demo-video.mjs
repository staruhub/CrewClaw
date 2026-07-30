import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

import { chromium } from "playwright";

const outputPath = resolve(
  process.env.CREWCLAW_DEMO_OUT || "artifacts/crewclaw-future-concept.zh-CN.mp4"
);
const workDir = await mkdtemp(join(tmpdir(), "crewclaw-concept-demo-"));
const rawPath = join(workDir, "crewclaw-concept-demo.webm");
const sleep = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

const sceneDefinitions = [
  {
    image: "docs/assets/demo-concept/01-marketplace.png",
    duration: 10_500,
    chapter: "00 / AI EMPLOYEE OS",
    headline: "别再调用一个工具。<em>雇一支 AI 团队。</em>",
    detail:
      "发现、检查、雇佣、协作、审计。把 AI 从一次性能力，变成可管理的数字员工。",
    chips: ["AI 人才市场", "角色匹配", "即招即用"],
    align: "left",
  },
  {
    image: "docs/assets/demo-concept/02-inspect.png",
    duration: 10_500,
    chapter: "01 / INSPECT",
    headline: "雇佣之前，<em>先看清它。</em>",
    detail:
      "能力、工具、价格、运行时与来源证据完整展开。不是承诺，是可验证的员工档案。",
    chips: ["能力清单", "工具边界", "供应链证据"],
    align: "right",
  },
  {
    image: "docs/assets/demo-concept/03-orchestrate.png",
    duration: 10_500,
    chapter: "02 / ORCHESTRATE",
    headline: "一个目标，<em>整支团队协作。</em>",
    detail:
      "研究、开发、设计与运营自动接力。任务、成本、进度和产物进入同一条工作流。",
    chips: ["任务编排", "并行协作", "交付汇总"],
    align: "left",
  },
  {
    image: "docs/assets/demo-concept/04-control.png",
    duration: 10_500,
    chapter: "03 / HUMAN CONTROL",
    headline: "权限可授予，<em>也可随时收回。</em>",
    detail:
      "敏感动作默认受限；全过程可审计、可暂停、可撤销。最终决定权始终在人。",
    chips: ["权限门禁", "全程审计", "一键暂停"],
    align: "right",
  },
  {
    image: "docs/assets/demo-concept/05-crew.png",
    duration: 12_500,
    chapter: "CREWCLAW / BETA 0.7",
    headline: "One person. One crew.<br /><em>One legion.</em>",
    detail: "全球首个 AI Agent 人才市场。发现、雇佣并管理你的下一位数字员工。",
    chips: ["crewhire.fly.dev"],
    align: "center",
    closing: true,
  },
];

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", code => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with code ${code}`));
    });
  });
}

function imageDataUrl(path) {
  const absolutePath = resolve(path);
  const extension = extname(absolutePath).slice(1).toLowerCase();
  const mimeType =
    extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "image/png";
  return `data:${mimeType};base64,${readFileSync(absolutePath).toString("base64")}`;
}

function sceneMarkup(scene, index, delay) {
  const chips = scene.chips
    .map(chip => `<span class="chip">${chip}</span>`)
    .join("");
  const image = imageDataUrl(scene.image);
  return `
    <section
      class="scene scene-${scene.align}${scene.closing ? " closing" : ""}"
      style="--delay:${delay}ms;--duration:${scene.duration}ms;--index:${index}"
    >
      <img class="scene-image" src="${image}" alt="" />
      <div class="atmosphere"></div>
      <div class="scan"></div>
      <div class="copy">
        <div class="chapter"><span>${scene.chapter}</span></div>
        <h1>${scene.headline}</h1>
        <p>${scene.detail}</p>
        <div class="chips">${chips}</div>
      </div>
      <div class="scene-number">${String(index + 1).padStart(2, "0")}</div>
    </section>`;
}

function demoMarkup() {
  let delay = 0;
  const scenes = sceneDefinitions
    .map((scene, index) => {
      const markup = sceneMarkup(scene, index, delay);
      delay += scene.duration;
      return markup;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: dark;
      font-family: "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
      background: #020706;
    }
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #020706;
    }
    body::before {
      content: "";
      position: fixed;
      z-index: 1000;
      inset: 0;
      pointer-events: none;
      opacity: .16;
      background-image:
        repeating-radial-gradient(circle at 15% 70%, transparent 0 2px, rgba(255,255,255,.055) 3px 4px),
        linear-gradient(rgba(255,255,255,.02), rgba(0,0,0,.035));
      mix-blend-mode: soft-light;
    }
    body::after {
      content: "";
      position: fixed;
      z-index: 1001;
      inset: 0;
      pointer-events: none;
      box-shadow: inset 0 0 230px 70px rgba(0,0,0,.78);
    }
    .brand {
      position: fixed;
      z-index: 1100;
      top: 56px;
      left: 72px;
      display: flex;
      align-items: center;
      gap: 15px;
      color: #effff4;
      font: 800 21px/1 ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
      text-shadow: 0 0 24px rgba(82,255,154,.38);
    }
    .brand::before {
      content: "";
      width: 12px;
      height: 12px;
      border: 2px solid #75f6a9;
      transform: rotate(45deg);
      box-shadow: 0 0 19px rgba(82,255,154,.9), inset 0 0 8px rgba(82,255,154,.5);
    }
    .progress {
      position: fixed;
      z-index: 1100;
      left: 72px;
      right: 72px;
      bottom: 46px;
      height: 2px;
      background: rgba(255,255,255,.11);
      overflow: hidden;
    }
    .progress::after {
      content: "";
      display: block;
      width: 100%;
      height: 100%;
      transform-origin: left;
      background: linear-gradient(90deg, #55f79c, #d7a56a);
      box-shadow: 0 0 18px rgba(85,247,156,.72);
      animation: progress ${delay}ms linear both;
    }
    .scene {
      position: absolute;
      inset: 0;
      overflow: hidden;
      opacity: 0;
      animation: scene-fade var(--duration) linear var(--delay) both;
      background: #020706;
    }
    .scene.closing {
      animation-name: scene-final;
    }
    .scene-image {
      position: absolute;
      inset: -5%;
      width: 110%;
      height: 110%;
      object-fit: cover;
      filter: saturate(.9) contrast(1.06) brightness(.82);
      transform: scale(1.04) translate3d(-1.5%, 0, 0);
      animation: drift var(--duration) cubic-bezier(.2,.55,.2,1) var(--delay) both;
    }
    .scene:nth-of-type(even) .scene-image {
      transform: scale(1.05) translate3d(1.5%, 0, 0);
      animation-name: drift-reverse;
    }
    .atmosphere {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 50% 42%, transparent 12%, rgba(1,7,5,.08) 45%, rgba(0,4,3,.64) 100%),
        linear-gradient(90deg, rgba(0,6,4,.87) 0%, rgba(0,6,4,.22) 45%, rgba(0,5,4,.7) 100%),
        linear-gradient(0deg, rgba(0,4,3,.8) 0%, transparent 42%);
    }
    .scene-right .atmosphere {
      background:
        radial-gradient(circle at 58% 42%, transparent 12%, rgba(1,7,5,.08) 48%, rgba(0,4,3,.64) 100%),
        linear-gradient(270deg, rgba(0,6,4,.88) 0%, rgba(0,6,4,.18) 46%, rgba(0,5,4,.66) 100%),
        linear-gradient(0deg, rgba(0,4,3,.82) 0%, transparent 42%);
    }
    .closing .atmosphere {
      background:
        radial-gradient(circle at 50% 45%, transparent 16%, rgba(1,7,5,.16) 58%, rgba(0,4,3,.72) 100%),
        linear-gradient(0deg, rgba(0,4,3,.88) 0%, transparent 56%);
    }
    .scan {
      position: absolute;
      left: -10%;
      right: -10%;
      top: -22%;
      height: 12%;
      opacity: .5;
      background: linear-gradient(transparent, rgba(102,255,168,.18), transparent);
      filter: blur(12px);
      animation: scan 6s ease-in-out calc(var(--delay) + 1s) both;
    }
    .copy {
      position: absolute;
      z-index: 3;
      left: 112px;
      width: min(790px, 46vw);
      top: 50%;
      transform: translateY(-46%);
      opacity: 0;
      animation: copy-in 1.25s cubic-bezier(.18,.72,.18,1) calc(var(--delay) + 780ms) both;
    }
    .scene-right .copy {
      left: auto;
      right: 112px;
      text-align: right;
    }
    .scene-center .copy {
      top: 44%;
      left: 50%;
      width: 1120px;
      text-align: center;
      transform: translate(-50%, -50%);
    }
    .chapter {
      display: flex;
      align-items: center;
      gap: 18px;
      margin-bottom: 32px;
      color: #7bf7ad;
      font: 800 20px/1.2 ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .chapter::before {
      content: "";
      width: 52px;
      height: 2px;
      background: #7bf7ad;
      box-shadow: 0 0 16px rgba(82,255,154,.8);
    }
    .scene-right .chapter { justify-content: flex-end; }
    .scene-right .chapter::before { order: 2; }
    .scene-center .chapter { justify-content: center; }
    h1 {
      margin: 0;
      color: #f4f7f3;
      font-size: 74px;
      line-height: 1.12;
      font-weight: 830;
      letter-spacing: -.055em;
      text-wrap: balance;
      text-shadow: 0 10px 45px rgba(0,0,0,.92);
    }
    h1 em {
      color: #69f6a2;
      font-style: normal;
      text-shadow: 0 0 34px rgba(82,255,154,.28), 0 10px 45px rgba(0,0,0,.92);
    }
    p {
      margin: 28px 0 0;
      color: rgba(232,240,234,.82);
      font-size: 26px;
      line-height: 1.7;
      letter-spacing: .012em;
      text-wrap: balance;
      text-shadow: 0 5px 30px rgba(0,0,0,.95);
    }
    .chips {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 34px;
    }
    .scene-right .chips { justify-content: flex-end; }
    .scene-center .chips { justify-content: center; }
    .chip {
      padding: 10px 16px;
      color: #eafff0;
      border: 1px solid rgba(119,247,171,.38);
      background: rgba(4,17,11,.58);
      box-shadow: inset 0 0 22px rgba(82,255,154,.055), 0 8px 30px rgba(0,0,0,.36);
      backdrop-filter: blur(14px);
      font: 650 17px/1.1 ui-monospace, "Cascadia Mono", "Microsoft YaHei UI", monospace;
      letter-spacing: .06em;
    }
    .scene-number {
      position: absolute;
      right: 72px;
      bottom: 72px;
      color: rgba(240,255,246,.48);
      font: 650 17px/1 ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: .12em;
    }
    .closing h1 {
      font: 850 88px/1.08 ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: -.07em;
      text-transform: uppercase;
    }
    .closing p {
      max-width: 900px;
      margin-left: auto;
      margin-right: auto;
    }
    .closing .chip {
      color: #16110b;
      border-color: transparent;
      background: #d7a56a;
      box-shadow: 0 0 34px rgba(215,165,106,.32);
    }
    @keyframes scene-fade {
      0% { opacity: 0; }
      7% { opacity: 1; }
      90% { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes scene-final {
      0% { opacity: 0; }
      7% { opacity: 1; }
      100% { opacity: 1; }
    }
    @keyframes drift {
      from { transform: scale(1.04) translate3d(-1.5%, 0, 0); }
      to { transform: scale(1.13) translate3d(1.4%, -1%, 0); }
    }
    @keyframes drift-reverse {
      from { transform: scale(1.05) translate3d(1.5%, 0, 0); }
      to { transform: scale(1.14) translate3d(-1.4%, -1%, 0); }
    }
    @keyframes copy-in {
      from { opacity: 0; filter: blur(10px); transform: translateY(calc(-46% + 28px)); }
      to { opacity: 1; filter: blur(0); transform: translateY(-46%); }
    }
    .scene-center .copy {
      animation-name: copy-in-center;
    }
    @keyframes copy-in-center {
      from { opacity: 0; filter: blur(10px); transform: translate(-50%, calc(-50% + 28px)); }
      to { opacity: 1; filter: blur(0); transform: translate(-50%, -50%); }
    }
    @keyframes scan {
      from { transform: translateY(0); opacity: 0; }
      15% { opacity: .45; }
      to { transform: translateY(920px); opacity: 0; }
    }
    @keyframes progress {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }
  </style>
</head>
<body>
  <div class="brand">CREWCLAW</div>
  ${scenes}
  <div class="progress"></div>
</body>
</html>`;
}

await mkdir(dirname(outputPath), { recursive: true });

const systemChrome = [
  process.env.CREWCLAW_DEMO_BROWSER,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find(candidate => candidate && existsSync(candidate));

const browser = await chromium.launch({
  headless: true,
  ...(systemChrome ? { executablePath: systemChrome } : {}),
});
const context = await browser.newContext({
  locale: "zh-CN",
  colorScheme: "dark",
  deviceScaleFactor: 1,
  viewport: { width: 1920, height: 1080 },
  recordVideo: {
    dir: workDir,
    size: { width: 1920, height: 1080 },
  },
});
const page = await context.newPage();
const video = page.video();
const totalDuration = sceneDefinitions.reduce(
  (total, scene) => total + scene.duration,
  0
);

try {
  await page.setContent(demoMarkup(), { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(totalDuration + 750);
} finally {
  await page.close();
  await video.saveAs(rawPath);
  await context.close();
  await browser.close();
}

await run("ffmpeg", [
  "-y",
  "-i",
  rawPath,
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "18",
  "-profile:v",
  "high",
  "-level",
  "4.2",
  "-pix_fmt",
  "yuv420p",
  "-r",
  "30",
  "-movflags",
  "+faststart",
  outputPath,
]);

console.log(`Rendered CrewClaw concept demo to ${outputPath}`);
