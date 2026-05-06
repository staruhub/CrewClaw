import fs from "node:fs/promises";
import path from "node:path";
import {
  Presentation,
  PresentationFile,
  column,
  row,
  grid,
  panel,
  text,
  shape,
  image,
  rule,
  fill,
  hug,
  fixed,
  wrap,
  grow,
  fr,
} from "@oai/artifact-tool";
import { slides, sourceLinks } from "./deck-data.mjs";
import { H, W, assets, c, type } from "./theme.mjs";

const outDir = path.resolve("output");
const scratchDir = path.resolve("scratch");
const previewDir = path.join(scratchDir, "previews");
const assetDataUrls = {};

function bg(slide, accent = c.blue) {
  slide.compose(shape({ width: fill, height: fill, fill: c.bg }), { frame: { left: 0, top: 0, width: W, height: H } });
  slide.compose(shape({ width: fill, height: fill, fill: accent }), { frame: { left: 0, top: 0, width: 28, height: H } });
  slide.compose(rule({ width: fixed(1640), stroke: c.faint, weight: 2 }), { frame: { left: 140, top: 930, width: 1640, height: 2 } });
}

function art(key) { return image({ name: `${key}-imagegen-art`, dataUrl: assetDataUrls[key], contentType: "image/png", width: fill, height: fill, fit: "cover", alt: key }); }

function footer(slide, page, source = "") {
  slide.compose(
    row({ width: fill, height: fill, justify: "between", align: "center" }, [
      text(source, { width: fixed(1400), height: hug, style: type.tiny }),
      text(String(page).padStart(2, "0"), { width: fixed(52), height: hug, style: { ...type.tiny, bold: true } }),
    ]),
    { frame: { left: 140, top: 982, width: 1640, height: 34 } },
  );
}

function header(slide, s, page, accent = c.blue) {
  bg(slide, accent);
  slide.compose(
    column({ width: fill, height: hug, gap: 12 }, [
      text("AGENT SKILLS FIELD GUIDE", { width: hug, height: hug, style: { ...type.label, color: accent, fontSize: 18 } }),
      text(s.title, { width: wrap(1280), height: hug, style: { ...type.title, fontSize: 58 } }),
    ]),
    { frame: { left: 140, top: 78, width: 1500, height: 170 } },
  );
  footer(slide, page, s.source);
}

function bulletList(items, color = c.ink, size = 30) {
  return column(
    { width: fill, height: hug, gap: 16 },
    items.map((item) => text(`- ${item}`, { width: fill, height: hug, style: { ...type.body, color, fontSize: size } })),
  );
}

function lane(label, body, accent) {
  return column({ width: fill, height: hug, gap: 18 }, [
    text(label, { width: fill, height: hug, style: { ...type.label, color: accent, fontSize: 22 } }),
    rule({ width: fixed(260), stroke: accent, weight: 5 }),
    text(body, { width: fill, height: hug, style: { ...type.body, fontSize: 31 } }),
  ]);
}

function addCover(slide, s, page) {
  slide.compose(art("cover"), { frame: { left: 0, top: 0, width: W, height: H } });
  slide.compose(shape({ width: fill, height: fill, fill: c.bg, opacity: 0.96 }), { frame: { left: 0, top: 0, width: 760, height: H } });
  slide.compose(shape({ width: fill, height: fill, fill: c.red }), { frame: { left: 0, top: 0, width: 28, height: H } });
  slide.compose(
    column({ width: fill, height: hug, gap: 28 }, [
      text(s.title, { width: wrap(560), height: hug, style: { ...type.cover, fontSize: 96 } }),
      rule({ width: fixed(440), stroke: c.red, weight: 9 }),
      text(s.subtitle, { width: wrap(560), height: hug, style: { ...type.sub, fontSize: 31, color: c.ink } }),
    ]),
    { frame: { left: 140, top: 170, width: 580, height: 560 } },
  );
  slide.compose(text(s.meta, { width: fixed(760), height: hug, style: { ...type.label, color: c.green } }), { frame: { left: 140, top: 840, width: 760, height: 40 } });
  footer(slide, page, s.source);
}

function addDefinition(slide, s, page) {
  bg(slide, c.blue);
  slide.compose(text("Skill 不是提示词库", { width: wrap(1180), height: hug, style: { ...type.cover, fontSize: 86, color: c.blue } }), {
    frame: { left: 140, top: 120, width: 1220, height: 110 },
  });
  slide.compose(text(s.lead, { width: wrap(1320), height: hug, style: { ...type.title, fontSize: 47, color: c.ink } }), {
    frame: { left: 140, top: 320, width: 1370, height: 130 },
  });
  slide.compose(
    row({ width: fill, height: hug, gap: 58 }, s.points.map(([a, b], i) => lane(a, b, [c.red, c.green, c.gold][i]))),
    { frame: { left: 150, top: 590, width: 1540, height: 230 } },
  );
  footer(slide, page, s.source);
}

function addWhy(slide, s, page) {
  bg(slide, c.green);
  slide.compose(text("为什么需要 Skills", { width: wrap(1200), height: hug, style: { ...type.cover, fontSize: 82 } }), {
    frame: { left: 140, top: 110, width: 1240, height: 110 },
  });
  slide.compose(text(s.thesis, { width: wrap(1040), height: hug, style: { ...type.cover, fontSize: 58, color: c.green } }), {
    frame: { left: 140, top: 310, width: 1100, height: 120 },
  });
  slide.compose(row({ width: fill, height: hug, gap: 100 }, s.lanes.map(([a, b], i) => lane(a, b, i ? c.blue : c.red))), {
    frame: { left: 180, top: 570, width: 1420, height: 230 },
  });
  footer(slide, page, s.source);
}

function addAnatomy(slide, s, page) {
  header(slide, s, page, c.gold);
  slide.compose(art("anatomy"), { frame: { left: 0, top: 260, width: 910, height: 560 } });
  slide.compose(shape({ width: fill, height: fill, fill: c.bg, opacity: 0.9 }), { frame: { left: 910, top: 250, width: 1010, height: 650 } });
  slide.compose(text(s.folder, { width: fixed(600), height: hug, style: { ...type.cover, fontSize: 72, color: c.gold } }), { frame: { left: 980, top: 318, width: 620, height: 90 } });
  slide.compose(
    column({ width: fill, height: hug, gap: 24 }, s.rows.map(([a, b], i) => row({ width: fill, height: hug, gap: 32 }, [
      text(a, { width: fixed(250), height: hug, style: { ...type.code, color: [c.blue, c.red, c.green, c.gold][i], fontSize: 34, bold: true } }),
      text(b, { width: fill, height: hug, style: { ...type.body, fontSize: 31 } }),
    ]))),
    { frame: { left: 1000, top: 472, width: 760, height: 300 } },
  );
}

function addFrontmatter(slide, s, page) {
  header(slide, s, page, c.blue);
  slide.compose(panel({ width: fill, height: fill, padding: { x: 46, y: 38 }, fill: c.charcoal, borderRadius: 8 }, column({ width: fill, height: hug, gap: 18 }, s.code.map((line) => text(line, { width: fill, height: hug, style: { ...type.code, fontSize: 30 } })))), {
    frame: { left: 140, top: 330, width: 870, height: 325 },
  });
  slide.compose(bulletList(s.rules, c.ink, 31), { frame: { left: 1090, top: 350, width: 650, height: 310 } });
  slide.compose(text("description 不是简介，是触发器。", { width: wrap(1120), height: hug, style: { ...type.cover, fontSize: 50, color: c.blue } }), { frame: { left: 140, top: 760, width: 1180, height: 70 } });
}

function addProgressive(slide, s, page) {
  header(slide, s, page, c.red);
  slide.compose(text(s.lead, { width: wrap(1280), height: hug, style: { ...type.body, fontSize: 38 } }), { frame: { left: 140, top: 300, width: 1320, height: 70 } });
  slide.compose(row({ width: fill, height: hug, gap: 60 }, s.steps.map(([n, a, b], i) => column({ width: grow(1), height: hug, gap: 18 }, [
    text(n, { width: fill, height: hug, style: { ...type.cover, fontSize: 112, color: [c.red, c.gold, c.green][i] } }),
    text(a, { width: fill, height: hug, style: { ...type.title, fontSize: 42 } }),
    text(b, { width: fill, height: hug, style: type.sub }),
  ]))), { frame: { left: 170, top: 510, width: 1550, height: 250 } });
  slide.compose(rule({ width: fixed(1240), stroke: c.faint, weight: 3 }), { frame: { left: 260, top: 590, width: 1240, height: 3 } });
}

function addTrigger(slide, s, page) {
  header(slide, s, page, c.gold);
  slide.compose(row({ width: fill, height: hug, gap: 100 }, [lane(s.left[0], s.left[1], c.red), lane(s.right[0], s.right[1], c.green)]), {
    frame: { left: 170, top: 350, width: 1500, height: 270 },
  });
  slide.compose(text("描述不是介绍文案，而是路由规则。", { width: wrap(1040), height: hug, style: { ...type.cover, fontSize: 54, color: c.gold } }), {
    frame: { left: 170, top: 750, width: 1120, height: 80 },
  });
}

function addChatgpt(slide, s, page) {
  header(slide, s, page, c.green);
  slide.compose(row({ width: fill, height: hug, gap: 42 }, s.steps.map((step, i) => column({ width: grow(1), height: hug, gap: 14 }, [
    text(`0${i + 1}`, { width: fill, height: hug, style: { ...type.label, color: [c.green, c.blue, c.gold, c.red][i], fontSize: 30 } }),
    rule({ width: fixed(220), stroke: [c.green, c.blue, c.gold, c.red][i], weight: 5 }),
    text(step, { width: fill, height: hug, style: { ...type.title, fontSize: 34 } }),
  ]))), { frame: { left: 145, top: 340, width: 1630, height: 200 } });
  slide.compose(text(s.note, { width: wrap(1460), height: hug, style: { ...type.body, fontSize: 34, color: c.green } }), { frame: { left: 145, top: 665, width: 1500, height: 145 } });
}

function addCodex(slide, s, page) {
  header(slide, s, page, c.blue);
  slide.compose(text(s.lead, { width: wrap(1420), height: hug, style: { ...type.cover, fontSize: 52, color: c.blue } }), { frame: { left: 140, top: 300, width: 1500, height: 128 } });
  slide.compose(grid({ width: fill, height: fill, columns: [fr(1), fr(1)], rows: [fr(1), fr(1)], columnGap: 52, rowGap: 36 }, s.examples.map((item, i) => lane(`0${i + 1}`, item, [c.blue, c.red, c.green, c.gold][i]))), {
    frame: { left: 170, top: 530, width: 1540, height: 310 },
  });
}

function addCompare(slide, s, page) {
  header(slide, s, page, c.red);
  slide.compose(column({ width: fill, height: hug, gap: 20 }, s.rows.map(([a, b, d], i) => row({ width: fill, height: hug, gap: 28, align: "center" }, [
    text(a, { width: fixed(250), height: hug, style: { ...type.title, fontSize: 42, color: [c.gold, c.blue, c.green, c.red][i] } }),
    text(b, { width: fixed(390), height: hug, style: { ...type.body, fontSize: 32, bold: true } }),
    text(d, { width: fill, height: hug, style: { ...type.sub, fontSize: 28 } }),
  ]))), { frame: { left: 170, top: 320, width: 1540, height: 420 } });
}

function addWriting(slide, s, page) {
  header(slide, s, page, c.green);
  slide.compose(column({ width: fill, height: hug, gap: 30 }, s.rules.map(([a, b], i) => row({ width: fill, height: hug, gap: 32, align: "start" }, [
    text(String(i + 1).padStart(2, "0"), { width: fixed(110), height: hug, style: { ...type.cover, fontSize: 52, color: [c.green, c.blue, c.gold, c.red][i] } }),
    column({ width: fill, height: hug, gap: 8 }, [text(a, { width: fill, height: hug, style: { ...type.title, fontSize: 36 } }), text(b, { width: fill, height: hug, style: type.sub })]),
  ]))), { frame: { left: 175, top: 310, width: 1520, height: 480 } });
}

function addScripts(slide, s, page) {
  header(slide, s, page, c.gold);
  slide.compose(art("scripts"), { frame: { left: 960, top: 250, width: 960, height: 610 } });
  slide.compose(shape({ width: fill, height: fill, fill: c.bg, opacity: 0.96 }), { frame: { left: 0, top: 250, width: 1030, height: 650 } });
  slide.compose(text(s.lead, { width: wrap(880), height: hug, style: { ...type.cover, fontSize: 46, color: c.gold } }), { frame: { left: 140, top: 292, width: 900, height: 130 } });
  slide.compose(row({ width: fill, height: hug, gap: 100 }, [lane("适合放", s.doList.join(" / "), c.green), lane("不要放", s.avoidList.join(" / "), c.red)]), {
    frame: { left: 170, top: 540, width: 820, height: 300 },
  });
}

function addGovernance(slide, s, page) {
  header(slide, s, page, c.blue);
  slide.compose(art("governance"), { frame: { left: 930, top: 250, width: 990, height: 610 } });
  slide.compose(shape({ width: fill, height: fill, fill: c.bg, opacity: 0.96 }), { frame: { left: 0, top: 250, width: 1040, height: 650 } });
  slide.compose(
    column(
      { width: fill, height: hug, gap: 24 },
      s.points.map(([a, b], i) =>
        row({ width: fill, height: hug, gap: 28, align: "start" }, [text(a, { width: fixed(170), height: hug, style: { ...type.label, color: [c.blue, c.green, c.gold, c.red][i], fontSize: 22 } }), text(b, { width: fill, height: hug, style: { ...type.sub, fontSize: 25 } })]),
      ),
    ),
    { frame: { left: 170, top: 340, width: 760, height: 410 } },
  );
}

function addRisk(slide, s, page) {
  header(slide, s, page, c.red);
  slide.compose(row({ width: fill, height: hug, gap: 34 }, s.risks.map(([a, b], i) => column({ width: grow(1), height: hug, gap: 20 }, [
    text(a, { width: fill, height: hug, style: { ...type.cover, fontSize: 56, color: [c.red, c.gold, c.blue, c.green][i] } }),
    rule({ width: fixed(210), stroke: [c.red, c.gold, c.blue, c.green][i], weight: 6 }),
    text(b, { width: fill, height: hug, style: { ...type.sub, fontSize: 26 } }),
  ]))), { frame: { left: 150, top: 390, width: 1620, height: 280 } });
}

function addRoadmap(slide, s, page) {
  header(slide, s, page, c.green);
  slide.compose(column({ width: fill, height: hug, gap: 34 }, s.steps.map(([a, b], i) => row({ width: fill, height: hug, gap: 40, align: "center" }, [
    text(a, { width: fixed(210), height: hug, style: { ...type.label, fontSize: 30, color: [c.green, c.blue, c.gold, c.red][i] } }),
    rule({ width: fixed(160), stroke: [c.green, c.blue, c.gold, c.red][i], weight: 5 }),
    text(b, { width: fill, height: hug, style: { ...type.body, fontSize: 34 } }),
  ]))), { frame: { left: 170, top: 330, width: 1500, height: 430 } });
}

function addClosing(slide, s, page) {
  slide.compose(art("cover"), { frame: { left: 900, top: 0, width: 1020, height: H } });
  slide.compose(shape({ width: fill, height: fill, fill: c.bg, opacity: 0.97 }), { frame: { left: 0, top: 0, width: 1040, height: H } });
  slide.compose(shape({ width: fill, height: fill, fill: c.blue }), { frame: { left: 0, top: 0, width: 28, height: H } });
  slide.compose(text(s.title, { width: wrap(1080), height: hug, style: { ...type.cover, fontSize: 92, color: c.blue } }), { frame: { left: 140, top: 160, width: 1120, height: 120 } });
  slide.compose(
    column({ width: fill, height: hug, gap: 18 }, [
      text("不是让 Agent 记住更多", { width: fill, height: hug, style: { ...type.cover, fontSize: 54 } }),
      text("而是让它在关键场景少犯同一种错", { width: fill, height: hug, style: { ...type.cover, fontSize: 54 } }),
    ]),
    { frame: { left: 140, top: 360, width: 1440, height: 155 } },
  );
  slide.compose(text(s.cta, { width: wrap(1300), height: hug, style: { ...type.body, fontSize: 40, color: c.green, bold: true } }), { frame: { left: 140, top: 650, width: 1350, height: 90 } });
  slide.compose(column({ width: fill, height: hug, gap: 10 }, s.links.map(([label, url]) => text(`${label}: ${url}`, { width: fill, height: hug, style: type.tiny }))), { frame: { left: 140, top: 820, width: 1300, height: 110 } });
  footer(slide, page, "官方资料链接见本页");
}

const builders = { cover: addCover, definition: addDefinition, why: addWhy, anatomy: addAnatomy, frontmatter: addFrontmatter, progressive: addProgressive, trigger: addTrigger, chatgpt: addChatgpt, codex: addCodex, compare: addCompare, writing: addWriting, scripts: addScripts, governance: addGovernance, risk: addRisk, roadmap: addRoadmap, closing: addClosing };

async function writePreviewHtml(count) {
  const slidesHtml = Array.from({ length: count }, (_, i) => `<figure><img src="scratch/previews/slide-${String(i + 1).padStart(2, "0")}.png" alt="Slide ${i + 1}"><figcaption>${String(i + 1).padStart(2, "0")}</figcaption></figure>`).join("\n");
  await fs.writeFile("preview.html", `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>关于 Skills 的一切</title><style>body{margin:0;background:#111827;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1180px;margin:auto;padding:28px}a{color:#93c5fd}figure{margin:0 0 28px}img{width:100%;border-radius:8px;box-shadow:0 18px 55px #0008}figcaption{margin:8px 0 0;color:#94a3b8;font:14px Menlo,monospace}</style></head><body><main><h1>关于 Skills 的一切</h1><p><a href="output/output.pptx">下载 PPTX</a></p>${slidesHtml}</main></body></html>`);
  await fs.writeFile(path.join(scratchDir, "sources.json"), JSON.stringify(sourceLinks, null, 2));
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  await Promise.all(Object.entries(assets).map(async ([key, assetPath]) => {
    const data = await fs.readFile(path.resolve(assetPath));
    assetDataUrls[key] = `data:image/png;base64,${data.toString("base64")}`;
  }));
  const deck = Presentation.create({ slideSize: { width: W, height: H } });
  slides.forEach((slideData, index) => builders[slideData.kind](deck.slides.add(), slideData, index + 1));
  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(path.join(outDir, "output.pptx"));
  const previewPaths = [];
  for (let i = 0; i < deck.slides.items.length; i += 1) {
    const blob = await deck.export({ slide: deck.slides.items[i], format: "png" });
    const file = path.join(previewDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    await fs.writeFile(file, Buffer.from(await blob.arrayBuffer()));
    previewPaths.push(file);
  }
  await fs.writeFile(path.join(scratchDir, "preview-manifest.json"), JSON.stringify({ pptx: path.join(outDir, "output.pptx"), previewPaths }, null, 2));
  await writePreviewHtml(deck.slides.items.length);
  console.log(JSON.stringify({ pptx: path.join(outDir, "output.pptx"), slides: deck.slides.items.length, previewDir }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
