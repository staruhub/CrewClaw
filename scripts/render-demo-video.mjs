import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { chromium } from "playwright";

const baseUrl = process.env.CREWCLAW_DEMO_URL || "http://localhost:3000";
const outputPath = resolve(
  process.env.CREWCLAW_DEMO_OUT || "public/crewclaw-demo.zh-CN.mp4"
);
const workDir = await mkdtemp(join(tmpdir(), "crewclaw-demo-"));
const rawPath = join(workDir, "crewclaw-demo.webm");

const sleep = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

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

function titleMarkup({ index, eyebrow, headline, detail, closing = false }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      color: #f7f2eb;
      background:
        radial-gradient(circle at 72% 42%, rgba(201, 120, 64, .18), transparent 28%),
        linear-gradient(rgba(255,255,255,.026) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.026) 1px, transparent 1px),
        #0b0908;
      background-size: auto, 42px 42px, 42px 42px, auto;
      font-family: "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
    }
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      background: linear-gradient(90deg, rgba(11,9,8,.35), transparent 40%, rgba(11,9,8,.18));
      pointer-events: none;
    }
    .rail {
      position: absolute;
      left: 92px;
      top: 78px;
      bottom: 78px;
      width: 2px;
      background: linear-gradient(#c97840, rgba(201,120,64,.08));
      transform-origin: top;
      animation: rail .8s ease-out both;
    }
    .wrap {
      position: absolute;
      left: 142px;
      right: 120px;
      top: 50%;
      transform: translateY(-50%);
    }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: 18px;
      color: #c97840;
      font: 700 23px/1.2 ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: .17em;
      text-transform: uppercase;
      animation: rise .7s .1s ease-out both;
    }
    .index {
      min-width: 64px;
      color: #201712;
      background: #c97840;
      border-radius: 4px;
      padding: 8px 12px;
      text-align: center;
      letter-spacing: .04em;
    }
    h1 {
      max-width: 1480px;
      margin: 34px 0 24px;
      font-size: ${closing ? 92 : 80}px;
      line-height: 1.12;
      font-weight: 760;
      letter-spacing: -.045em;
      text-wrap: balance;
      animation: rise .8s .22s ease-out both;
    }
    h1 em { color: #c97840; font-style: normal; }
    p {
      max-width: 1120px;
      margin: 0;
      color: #b8aaa0;
      font: 400 28px/1.65 "Microsoft YaHei UI", sans-serif;
      letter-spacing: .02em;
      animation: rise .8s .34s ease-out both;
    }
    .status {
      position: absolute;
      right: 92px;
      bottom: 74px;
      display: flex;
      align-items: center;
      gap: 12px;
      color: #7f8f7f;
      font: 600 17px ui-monospace, "Cascadia Mono", monospace;
      letter-spacing: .09em;
      animation: rise .6s .5s ease-out both;
    }
    .status::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 99px;
      background: #70b88a;
      box-shadow: 0 0 22px rgba(112,184,138,.8);
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(24px); filter: blur(7px); }
      to { opacity: 1; transform: translateY(0); filter: blur(0); }
    }
    @keyframes rail {
      from { transform: scaleY(0); }
      to { transform: scaleY(1); }
    }
  </style>
</head>
<body>
  <div class="rail"></div>
  <main class="wrap">
    <div class="eyebrow"><span class="index">${index}</span>${eyebrow}</div>
    <h1>${headline}</h1>
    <p>${detail}</p>
  </main>
  <div class="status">CREWCLAW / BETA 0.7</div>
</body>
</html>`;
}

async function showTitle(page, options, durationMs) {
  await page.setContent(titleMarkup(options), { waitUntil: "load" });
  await sleep(durationMs);
}

async function addOverlay(page, { chapter, headline, detail }) {
  await page.evaluate(
    ({ chapterText, headlineText, detailText }) => {
      document.getElementById("crewclaw-demo-overlay")?.remove();
      document.getElementById("crewclaw-demo-style")?.remove();

      const style = document.createElement("style");
      style.id = "crewclaw-demo-style";
      style.textContent = `
        html { scroll-behavior: smooth !important; }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
        #crewclaw-demo-overlay {
          position: fixed;
          z-index: 2147483647;
          left: 54px;
          right: 54px;
          bottom: 42px;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 22px;
          align-items: center;
          padding: 18px 24px;
          color: #f8f3ed;
          border: 1px solid rgba(255,255,255,.12);
          border-left: 4px solid #c97840;
          border-radius: 7px;
          background: linear-gradient(90deg, rgba(13,10,8,.96), rgba(13,10,8,.84));
          box-shadow: 0 20px 70px rgba(0,0,0,.46);
          backdrop-filter: blur(18px);
          font-family: "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif;
          pointer-events: none;
          animation: crew-demo-in .55s ease-out both;
        }
        #crewclaw-demo-overlay .chapter {
          align-self: stretch;
          display: grid;
          place-items: center;
          min-width: 124px;
          padding: 0 18px;
          color: #21160f;
          border-radius: 4px;
          background: #c97840;
          font: 800 18px ui-monospace, "Cascadia Mono", monospace;
          letter-spacing: .11em;
        }
        #crewclaw-demo-overlay .headline {
          font-size: 30px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: -.025em;
        }
        #crewclaw-demo-overlay .detail {
          margin-top: 7px;
          color: #c5b7ad;
          font-size: 18px;
          line-height: 1.5;
          letter-spacing: .01em;
        }
        #crewclaw-demo-cursor {
          position: fixed;
          z-index: 2147483646;
          left: 50%;
          top: 50%;
          width: 28px;
          height: 28px;
          border: 3px solid #f3a066;
          border-radius: 50%;
          box-shadow: 0 0 0 7px rgba(201,120,64,.18), 0 0 26px rgba(201,120,64,.7);
          transform: translate(-50%, -50%);
          transition: left 1.05s cubic-bezier(.2,.75,.2,1), top 1.05s cubic-bezier(.2,.75,.2,1);
          pointer-events: none;
        }
        @keyframes crew-demo-in {
          from { opacity: 0; transform: translateY(28px); filter: blur(6px); }
          to { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `;
      document.head.appendChild(style);

      const overlay = document.createElement("div");
      overlay.id = "crewclaw-demo-overlay";
      overlay.innerHTML = `
        <div class="chapter">${chapterText}</div>
        <div>
          <div class="headline">${headlineText}</div>
          <div class="detail">${detailText}</div>
        </div>
      `;
      document.body.appendChild(overlay);

      const cursor = document.createElement("div");
      cursor.id = "crewclaw-demo-cursor";
      document.body.appendChild(cursor);
    },
    { chapterText: chapter, headlineText: headline, detailText: detail }
  );
}

async function moveCursor(page, x, y) {
  await page.evaluate(
    ({ left, top }) => {
      const cursor = document.getElementById("crewclaw-demo-cursor");
      if (!cursor) return;
      cursor.style.left = `${left}px`;
      cursor.style.top = `${top}px`;
    },
    { left: x, top: y }
  );
  await sleep(1_150);
}

async function gotoScene(page, path, overlay) {
  await page.goto(new URL(path, baseUrl).href, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  await page.evaluate(() =>
    localStorage.setItem("crewclaw.locale.v1", "zh-CN")
  );
  if ((await page.locator("html").getAttribute("lang")) !== "zh-CN") {
    await page.reload({ waitUntil: "networkidle" });
  }
  await addOverlay(page, overlay);
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

try {
  await showTitle(
    page,
    {
      index: "00",
      eyebrow: "AI EMPLOYEE OS",
      headline: "把 AI 当成<em>员工</em>，而不是一次性工具。",
      detail: "发现、雇佣、授权、监督、验收。每一步都有边界，也都有证据。",
    },
    4_400
  );

  await gotoScene(page, "/", {
    chapter: "WHY",
    headline: "一套面向 AI 员工的完整管理闭环",
    detail: "从人才市场到人工验收，不再把权限、成本和交付质量留在黑盒里。",
  });
  await moveCursor(page, 1_470, 185);
  await sleep(1_300);
  await page.evaluate(() => window.scrollTo({ top: 610, behavior: "smooth" }));
  await sleep(2_600);

  await showTitle(
    page,
    {
      index: "01",
      eyebrow: "DISCOVER",
      headline: "先看<em>能力与证据</em>，再决定雇谁。",
      detail: "角色、价格、运行时、权限和验证状态统一公开。",
    },
    2_300
  );

  await gotoScene(page, "/marketplace", {
    chapter: "01 / 发现",
    headline: "像筛选候选人一样浏览 AI 员工",
    detail: "按角色、证据级别和可用状态比较，避免只看一句漂亮的能力介绍。",
  });
  await moveCursor(page, 1_090, 287);
  await page.evaluate(() => window.scrollTo({ top: 720, behavior: "smooth" }));
  await sleep(2_600);
  await moveCursor(page, 380, 460);
  await sleep(1_700);

  await gotoScene(page, "/employee/ai-adoption-whale", {
    chapter: "02 / 档案",
    headline: "雇佣前，先把边界看清楚",
    detail: "能力声明、工具范围、交付物、证据等级与定价都写进员工档案。",
  });
  await moveCursor(page, 280, 690);
  await page.evaluate(() => window.scrollTo({ top: 680, behavior: "smooth" }));
  await sleep(2_500);
  await page.evaluate(() =>
    window.scrollTo({ top: 1_420, behavior: "smooth" })
  );
  await sleep(2_500);

  await showTitle(
    page,
    {
      index: "02",
      eyebrow: "HIRE SAFELY",
      headline: "授权不是一个按钮，<em>而是一道门禁。</em>",
      detail: "合同、权限、预算、Doctor 与试运行逐项确认。",
    },
    2_300
  );

  await gotoScene(page, "/hire/ai-adoption-whale", {
    chapter: "03 / 雇佣",
    headline: "逐项审查能力、预算与运行环境",
    detail: "必需能力锁定，敏感能力默认关闭；高风险动作必须由人确认。",
  });
  await moveCursor(page, 1_430, 430);
  await page.evaluate(() => window.scrollTo({ top: 760, behavior: "smooth" }));
  await sleep(2_600);
  await page.evaluate(() =>
    window.scrollTo({ top: 1_620, behavior: "smooth" })
  );
  await sleep(2_600);
  await moveCursor(page, 1_520, 650);
  await sleep(1_500);

  await showTitle(
    page,
    {
      index: "03",
      eyebrow: "SUPERVISE",
      headline: "AI 在做什么，<em>全过程可见。</em>",
      detail: "动作、工具、成本、证据与产物进入同一个工作台。",
    },
    2_300
  );

  await gotoScene(page, "/task-run/task_1719306072000", {
    chapter: "04 / 监督",
    headline: "时间线、证据、产物与人工验收在同一屏",
    detail: "越权操作被拦截；没有证据的交付，不能悄悄变成“已完成”。",
  });
  await moveCursor(page, 540, 515);
  const firstRow = page.getByRole("row").nth(1);
  if (await firstRow.isVisible().catch(() => false)) {
    await firstRow.click().catch(() => {});
  }
  await sleep(2_200);
  await page.evaluate(() => window.scrollTo({ top: 740, behavior: "smooth" }));
  await sleep(2_700);
  await page.evaluate(() =>
    window.scrollTo({ top: 1_450, behavior: "smooth" })
  );
  await sleep(2_700);

  await showTitle(
    page,
    {
      index: "✓",
      eyebrow: "HUMAN IN CONTROL",
      headline: "最终决定权，<em>始终在人。</em>",
      detail: "CrewClaw — 让 AI 从“能运行”，走向“可管理、可验收、可持续”。",
      closing: true,
    },
    5_000
  );
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

console.log(`Rendered CrewClaw demo to ${outputPath}`);
