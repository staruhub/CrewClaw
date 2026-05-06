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
import { assets, slides } from "./deck-data.mjs";

const W = 1920;
const H = 1080;
const outDir = path.resolve("output");
const scratchDir = path.resolve("scratch");
const previewDir = path.join(scratchDir, "previews");
const assetDataUrls = {};

const c = {
  bg: "#0D1117",
  ink: "#F8FAFC",
  paper: "#EAF2FF",
  muted: "#A7B0C0",
  dim: "#627084",
  orange: "#FF6A00",
  blue: "#3B82F6",
  green: "#00FF88",
  red: "#EF4444",
  line: "#263244",
  bluePanel: "#101826",
  redPanel: "#1A1014",
};

const font = "PingFang SC";
const mono = "Menlo";
const type = {
  kicker: { fontFamily: mono, fontSize: 19, color: c.green, bold: true },
  title: { fontFamily: font, fontSize: 62, color: c.ink, bold: true },
  cover: { fontFamily: font, fontSize: 112, color: c.ink, bold: true },
  body: { fontFamily: font, fontSize: 30, color: c.paper },
  sub: { fontFamily: font, fontSize: 27, color: c.muted },
  small: { fontFamily: font, fontSize: 17, color: c.dim },
  mono: { fontFamily: mono, fontSize: 22, color: c.green },
};

function addSolidBg(slide, tone = "blue") {
  const accent = tone === "red" ? c.red : tone === "green" ? c.green : c.blue;
  slide.compose(shape({ width: fill, height: fill, fill: tone === "red" ? "#12090D" : c.bg }), {
    frame: { left: 0, top: 0, width: W, height: H },
  });
  slide.compose(shape({ width: fill, height: fill, fill: accent }), {
    frame: { left: 82, top: 72, width: 6, height: 936 },
  });
  for (let i = 0; i < 6; i += 1) {
    slide.compose(shape({ width: fill, height: 2, fill: i % 2 ? "#172033" : "#1E2C45" }), {
      frame: { left: 118, top: 230 + i * 128, width: 1682, height: 2 },
    });
  }
}

function addArt(slide, key, matte = "left") {
  addSolidBg(slide);
  slide.compose(
    image({
      name: `${key}-image`,
      dataUrl: assetDataUrls[key],
      contentType: "image/png",
      width: fill,
      height: fill,
      fit: "cover",
      alt: key,
    }),
    { frame: { left: 0, top: 0, width: W, height: H } },
  );
  if (matte === "left") {
    slide.compose(shape({ width: fill, height: fill, fill: c.bg }), {
      frame: { left: 0, top: 0, width: 720, height: H },
    });
  }
  if (matte === "right") {
    slide.compose(shape({ width: fill, height: fill, fill: c.bg }), {
      frame: { left: 1150, top: 0, width: 770, height: H },
    });
  }
}

function footer(slide, page, source) {
  slide.compose(
    row({ width: fill, height: fill, justify: "between", align: "center" }, [
      text(source || "ArkClaw × 艺术设计 × AI 安全", {
        width: fixed(1430),
        height: hug,
        style: { ...type.small, color: "#6D7A8E" },
      }),
      text(String(page).padStart(2, "0"), {
        width: fixed(60),
        height: hug,
        style: { ...type.small, fontFamily: mono, color: "#7A8798" },
      }),
    ]),
    { frame: { left: 120, top: 1012, width: 1680, height: 34 } },
  );
}

function titleArea(slide, s, page, tone = "blue") {
  const accent = tone === "red" ? c.red : tone === "green" ? c.green : c.orange;
  slide.compose(
    column({ width: fill, height: hug, gap: 16 }, [
      text(`SCENE ${String(page).padStart(2, "0")}`, { width: hug, height: hug, style: { ...type.kicker, color: accent } }),
      text(s.title, { width: wrap(1280), height: hug, style: type.title }),
      s.subtitle ? text(s.subtitle, { width: wrap(1180), height: hug, style: type.sub }) : text("", { width: fixed(1), height: hug, style: type.small }),
    ]),
    { frame: { left: 120, top: 82, width: 1500, height: 240 } },
  );
  footer(slide, page, s.source);
}

function openList(items, color = c.paper, size = 30) {
  return column(
    { width: fill, height: hug, gap: 16 },
    items.map((item) => text(item, { width: fill, height: hug, style: { ...type.body, fontSize: size, color } })),
  );
}

function thinLabel(label, color = c.green) {
  return row({ width: hug, height: hug, gap: 12, align: "center" }, [
    shape({ width: fixed(44), height: fixed(3), fill: color }),
    text(label, { width: hug, height: hug, style: { ...type.kicker, color } }),
  ]);
}

function noteLine(a, b, color = c.blue) {
  return row({ width: fill, height: hug, gap: 20, align: "start" }, [
    text(a, { width: fixed(210), height: hug, style: { ...type.kicker, color, fontSize: 21 } }),
    text(b, { width: fill, height: hug, style: { ...type.body, fontSize: 28 } }),
  ]);
}

function addCover(slide, s, page) {
  addArt(slide, s.art, "left");
  slide.compose(
    column({ width: fill, height: hug, gap: 28 }, [
      text("ARKCLAW / DESIGN / SECURITY", { width: hug, height: hug, style: { ...type.kicker, color: c.green } }),
      text(s.title, { width: wrap(600), height: hug, style: type.cover }),
      rule({ width: fixed(360), stroke: c.orange, weight: 7 }),
      text(s.subtitle, { width: wrap(650), height: hug, style: { ...type.sub, fontSize: 30, color: "#D9E6FA" } }),
    ]),
    { frame: { left: 110, top: 134, width: 660, height: 620 } },
  );
  slide.compose(text(s.meta, { width: wrap(760), height: hug, style: { ...type.body, fontSize: 24 } }), {
    frame: { left: 110, top: 840, width: 760, height: 48 },
  });
  slide.compose(text(s.speaker, { width: wrap(980), height: hug, style: { ...type.small, fontSize: 18 } }), {
    frame: { left: 110, top: 908, width: 980, height: 36 },
  });
  footer(slide, page);
}

function addProfile(slide, s, page) {
  addSolidBg(slide);
  titleArea(slide, s, page);
  slide.compose(text("PONG", { width: fixed(760), height: hug, style: { ...type.cover, fontSize: 112, color: c.green } }), {
    frame: { left: 126, top: 350, width: 760, height: 140 },
  });
  slide.compose(text(`“${s.quote}”`, { width: wrap(620), height: hug, style: { ...type.title, fontSize: 44, color: c.orange } }), {
    frame: { left: 126, top: 540, width: 680, height: 120 },
  });
  slide.compose(
    column({ width: fill, height: hug, gap: 20 }, s.lines.map((line, index) => noteLine(String(index + 1).padStart(2, "0"), line, index % 2 ? c.blue : c.green))),
    { frame: { left: 860, top: 330, width: 820, height: 420 } },
  );
  slide.compose(text("从讲台到代码，从代码到创作现场。", { width: wrap(880), height: hug, style: { ...type.body, fontSize: 34 } }), {
    frame: { left: 860, top: 818, width: 880, height: 56 },
  });
}

function addStatement(slide, s, page) {
  addArt(slide, s.art, "left");
  slide.compose(
    column({ width: fill, height: hug, gap: 24 }, [
      thinLabel("AI AGENT YEAR", c.orange),
      text(s.title, { width: wrap(620), height: hug, style: { ...type.title, fontSize: 70 } }),
      text(s.subtitle, { width: wrap(620), height: hug, style: { ...type.sub, fontSize: 30 } }),
      rule({ width: fixed(300), stroke: c.green, weight: 6 }),
      text(s.claim, { width: wrap(610), height: hug, style: { ...type.body, fontSize: 38, color: c.green, bold: true } }),
    ]),
    { frame: { left: 106, top: 136, width: 640, height: 650 } },
  );
  slide.compose(row({ width: fill, height: hug, gap: 18 }, s.lines.map((item) => text(item, { width: fixed(142), height: hug, style: { ...type.mono, color: c.paper } }))), {
    frame: { left: 106, top: 830, width: 660, height: 50 },
  });
  footer(slide, page, s.source);
}

function addAtelier(slide, s, page) {
  addSolidBg(slide);
  titleArea(slide, s, page);
  slide.compose(
    grid(
      { width: fill, height: fill, columns: [fr(1), fr(1), fr(1), fr(1), fr(1)], rows: [fr(1)], columnGap: 26 },
      s.items.map(([a, b], index) =>
        column({ width: fill, height: fill, gap: 18 }, [
          text(`0${index + 1}`, { width: fill, height: hug, style: { ...type.kicker, color: index % 2 ? c.blue : c.orange } }),
          rule({ width: fixed(148), stroke: index % 2 ? c.blue : c.orange, weight: 5 }),
          text(a, { width: fill, height: hug, style: { ...type.body, fontSize: 32, bold: true } }),
          text(b, { width: fill, height: hug, style: { ...type.sub, fontSize: 23 } }),
        ]),
      ),
    ),
    { frame: { left: 128, top: 390, width: 1660, height: 290 } },
  );
  slide.compose(text("不是把电脑交给 AI，而是把高权限动作放进更清楚的工作台。", { width: wrap(1320), height: hug, style: { ...type.title, fontSize: 46, color: c.green } }), {
    frame: { left: 128, top: 776, width: 1400, height: 92 },
  });
}

function addSection(slide, s, page) {
  addArt(slide, s.art, "none");
  const accent = s.tone === "red" ? c.red : c.orange;
  slide.compose(
    column({ width: fill, height: hug, gap: 28 }, [
      thinLabel(s.kicker, accent),
      text(s.title, { width: wrap(900), height: hug, style: { ...type.cover, fontSize: 104 } }),
      rule({ width: fixed(360), stroke: accent, weight: 8 }),
      text(s.subtitle, { width: wrap(900), height: hug, style: { ...type.sub, fontSize: 34, color: "#E8EEF8" } }),
    ]),
    { frame: { left: 120, top: 210, width: 930, height: 600 } },
  );
  footer(slide, page);
}

function addPromptDemo(slide, s, page) {
  addArt(slide, s.art, "left");
  slide.compose(
    column({ width: fill, height: hug, gap: 24 }, [
      thinLabel("PROMPT AS MATERIAL", c.green),
      text(s.title, { width: wrap(600), height: hug, style: { ...type.title, fontSize: 66 } }),
      text(`“${s.prompt}”`, { width: wrap(620), height: hug, style: { ...type.body, fontSize: 34, color: c.orange, bold: true } }),
      rule({ width: fixed(300), stroke: c.green, weight: 6 }),
      openList(s.lines, c.paper, 27),
    ]),
    { frame: { left: 104, top: 128, width: 630, height: 700 } },
  );
  slide.compose(text(s.quote, { width: wrap(670), height: hug, style: { ...type.title, fontSize: 44, color: c.green } }), {
    frame: { left: 104, top: 840, width: 700, height: 80 },
  });
  footer(slide, page);
}

function addPosterVariants(slide, s, page) {
  addSolidBg(slide);
  titleArea(slide, s, page);
  const fills = ["#EAF2FF", "#12192C", "#17140F"];
  const colors = [c.bg, c.paper, c.paper];
  slide.compose(
    row(
      { width: fill, height: fill, gap: 30 },
      s.styles.map(([name, mood], index) =>
        panel(
          {
            width: grow(1),
            height: fill,
            padding: { x: 30, y: 30 },
            fill: fills[index],
            stroke: index === 0 ? c.orange : index === 1 ? c.blue : c.green,
            borderRadius: 6,
          },
          column({ width: fill, height: fill, justify: "between" }, [
            text(name, { width: fill, height: hug, style: { ...type.title, fontSize: 40, color: colors[index] } }),
            text(mood, { width: fill, height: hug, style: { ...type.sub, color: index === 0 ? "#334155" : c.muted } }),
          ]),
        ),
      ),
    ),
    { frame: { left: 126, top: 350, width: 1668, height: 310 } },
  );
  slide.compose(text(s.punch, { width: wrap(1220), height: hug, style: { ...type.cover, fontSize: 58, color: c.orange } }), {
    frame: { left: 126, top: 770, width: 1300, height: 80 },
  });
  footer(slide, page);
}

function addTimeline(slide, s, page) {
  addSolidBg(slide);
  titleArea(slide, s, page);
  slide.compose(text(`“${s.prompt}”`, { width: wrap(1420), height: hug, style: { ...type.body, fontSize: 34, color: c.green, bold: true } }), {
    frame: { left: 126, top: 330, width: 1500, height: 90 },
  });
  slide.compose(
    row({ width: fill, height: fill, gap: 0 }, s.steps.map((step, index) =>
      column({ width: grow(1), height: fill, gap: 18 }, [
        text(`0${index + 1}`, { width: fill, height: hug, style: { ...type.kicker, color: [c.orange, c.blue, c.green, c.orange][index], fontSize: 24 } }),
        rule({ width: fixed(250), stroke: [c.orange, c.blue, c.green, c.orange][index], weight: 6 }),
        text(step, { width: fill, height: hug, style: { ...type.title, fontSize: 48 } }),
      ]),
    )),
    { frame: { left: 126, top: 520, width: 1660, height: 190 } },
  );
  slide.compose(text(s.quote, { width: wrap(1180), height: hug, style: { ...type.cover, fontSize: 54, color: c.orange } }), {
    frame: { left: 126, top: 806, width: 1260, height: 80 },
  });
  footer(slide, page);
}

function addWorkflow(slide, s, page) {
  addArt(slide, s.art, "right");
  slide.compose(
    column({ width: fill, height: hug, gap: 22 }, [
      thinLabel("AUTOMATION FLOW", c.green),
      text(s.title, { width: wrap(620), height: hug, style: { ...type.title, fontSize: 62 } }),
      text(s.quote, { width: wrap(640), height: hug, style: { ...type.title, fontSize: 38, color: c.green } }),
    ]),
    { frame: { left: 1220, top: 120, width: 620, height: 420 } },
  );
  slide.compose(column({ width: fill, height: hug, gap: 18 }, s.steps.map((step, i) => noteLine(String(i + 1).padStart(2, "0"), step, [c.orange, c.blue, c.green, c.orange][i]))), {
    frame: { left: 1220, top: 560, width: 620, height: 210 },
  });
  slide.compose(row({ width: fill, height: hug, gap: 18 }, s.cases.map((item) => text(item, { width: fixed(140), height: hug, style: { ...type.small, fontSize: 18, color: c.paper } }))), {
    frame: { left: 1220, top: 848, width: 620, height: 42 },
  });
  footer(slide, page);
}

function addRiskPrompt(slide, s, page) {
  addArt(slide, s.art, "left");
  slide.compose(
    column({ width: fill, height: hug, gap: 22 }, [
      thinLabel("PROMPT INJECTION", c.red),
      text(s.title, { width: wrap(610), height: hug, style: { ...type.cover, fontSize: 84, color: c.red } }),
      text(s.subtitle, { width: wrap(610), height: hug, style: { ...type.sub, fontSize: 30 } }),
      rule({ width: fixed(300), stroke: c.red, weight: 7 }),
    ]),
    { frame: { left: 106, top: 128, width: 640, height: 430 } },
  );
  slide.compose(column({ width: fill, height: hug, gap: 16 }, s.flow.map((item, index) => noteLine(String(index + 1).padStart(2, "0"), item, index === s.flow.length - 1 ? c.red : c.orange))), {
    frame: { left: 106, top: 600, width: 640, height: 220 },
  });
  slide.compose(text(s.analogy, { width: wrap(640), height: hug, style: { ...type.body, fontSize: 25, color: c.paper } }), {
    frame: { left: 106, top: 858, width: 650, height: 80 },
  });
  footer(slide, page, s.source);
}

function addRiskSkills(slide, s, page) {
  addSolidBg(slide, "red");
  titleArea(slide, s, page, "red");
  slide.compose(
    column(
      { width: fill, height: hug, gap: 34 },
      s.risks.map(([name, body], index) =>
        row({ width: fill, height: hug, gap: 28, align: "start" }, [
          text(index === 2 ? "26%" : `0${index + 1}`, { width: fixed(160), height: hug, style: { ...type.cover, fontSize: 54, color: index === 1 ? c.orange : c.red } }),
          column({ width: fill, height: hug, gap: 10 }, [
            text(name, { width: fill, height: hug, style: { ...type.title, fontSize: 38 } }),
            text(body, { width: fill, height: hug, style: { ...type.sub, fontSize: 25 } }),
          ]),
        ]),
      ),
    ),
    { frame: { left: 178, top: 350, width: 1500, height: 360 } },
  );
  slide.compose(text("高权限 Agent 的问题不是“聪明”，而是“能动手”。", { width: wrap(1320), height: hug, style: { ...type.cover, fontSize: 52, color: c.red } }), {
    frame: { left: 178, top: 812, width: 1450, height: 80 },
  });
  footer(slide, page, s.source);
}

function addSafety(slide, s, page) {
  addArt(slide, s.art, "right");
  slide.compose(
    column({ width: fill, height: hug, gap: 24 }, [
      thinLabel("SAFE BOUNDARY", c.green),
      text(s.title, { width: wrap(630), height: hug, style: { ...type.title, fontSize: 66 } }),
      text(s.subtitle, { width: wrap(620), height: hug, style: { ...type.sub, fontSize: 27 } }),
    ]),
    { frame: { left: 1200, top: 112, width: 620, height: 420 } },
  );
  slide.compose(column({ width: fill, height: hug, gap: 18 }, s.layers.map(([name, body], i) => noteLine(String(i + 1).padStart(2, "0"), `${name}：${body}`, [c.blue, c.green, c.orange, c.blue][i]))), {
    frame: { left: 1200, top: 582, width: 640, height: 260 },
  });
  footer(slide, page, s.source);
}

function addHabits(slide, s, page) {
  addSolidBg(slide);
  titleArea(slide, s, page);
  slide.compose(
    grid(
      { width: fill, height: fill, columns: [fr(1), fr(1)], rows: [fr(1), fr(1)], columnGap: 40, rowGap: 42 },
      s.habits.map(([num, title, body], index) =>
        row({ width: fill, height: fill, gap: 28, align: "start" }, [
          text(num, { width: fixed(120), height: hug, style: { ...type.cover, fontSize: 58, color: [c.orange, c.blue, c.green, c.red][index] } }),
          column({ width: fill, height: hug, gap: 12 }, [
            text(title, { width: fill, height: hug, style: { ...type.title, fontSize: 34 } }),
            text(body, { width: fill, height: hug, style: { ...type.sub, fontSize: 23 } }),
          ]),
        ]),
      ),
    ),
    { frame: { left: 150, top: 360, width: 1600, height: 430 } },
  );
  footer(slide, page, s.source);
}

function addSummary(slide, s, page) {
  addArt(slide, s.art, "none");
  slide.compose(
    column({ width: fill, height: hug, gap: 24, align: "center" }, [
      text(s.title, { width: wrap(1100), height: hug, style: { ...type.cover, fontSize: 76 } }),
      rule({ width: fixed(360), stroke: c.orange, weight: 7 }),
      text(s.quote, { width: wrap(1050), height: hug, style: { ...type.sub, fontSize: 31, color: c.paper } }),
    ]),
    { frame: { left: 410, top: 88, width: 1100, height: 330 } },
  );
  const side = (title, items, color) =>
    column({ width: fill, height: hug, gap: 20 }, [
      text(title, { width: fill, height: hug, style: { ...type.title, fontSize: 42, color } }),
      openList(items.map((item) => `· ${item}`), c.paper, 28),
    ]);
  slide.compose(side(s.leftTitle, s.left, c.green), { frame: { left: 130, top: 550, width: 520, height: 260 } });
  slide.compose(side(s.rightTitle, s.right, c.red), { frame: { left: 1280, top: 550, width: 520, height: 260 } });
  footer(slide, page);
}

function addClosing(slide, s, page) {
  addArt(slide, s.art, "left");
  slide.compose(
    column({ width: fill, height: hug, gap: 30 }, [
      thinLabel("CHAO GEEK", c.green),
      text(s.title, { width: wrap(620), height: hug, style: { ...type.cover, fontSize: 78, color: c.green } }),
      rule({ width: fixed(330), stroke: c.orange, weight: 7 }),
      column({ width: fill, height: hug, gap: 18 }, s.links.map((line) => text(line, { width: fill, height: hug, style: { ...type.body, fontSize: 26 } }))),
    ]),
    { frame: { left: 106, top: 154, width: 660, height: 600 } },
  );
  slide.compose(text(s.question, { width: wrap(660), height: hug, style: { ...type.title, fontSize: 45, color: c.orange } }), {
    frame: { left: 106, top: 822, width: 690, height: 70 },
  });
  slide.compose(
    panel(
      { width: fill, height: fill, padding: 26, fill: "#F8FAFC", stroke: c.green, borderRadius: 8 },
      column({ width: fill, height: fill, justify: "center", gap: 12, align: "center" }, [
        text("ChaoGeek", { width: fill, height: hug, style: { ...type.title, fontSize: 36, color: c.bg } }),
        text("公众号扫码位", { width: fill, height: hug, style: { ...type.sub, fontSize: 22, color: "#334155" } }),
      ]),
    ),
    { frame: { left: 1470, top: 720, width: 270, height: 270 } },
  );
  footer(slide, page, "volcengine.com/product/arkclaw · ChaoGeek");
}

const builders = {
  cover: addCover,
  profile: addProfile,
  statement: addStatement,
  atelier: addAtelier,
  section: addSection,
  promptDemo: addPromptDemo,
  posterVariants: addPosterVariants,
  timeline: addTimeline,
  workflow: addWorkflow,
  riskPrompt: addRiskPrompt,
  riskSkills: addRiskSkills,
  safety: addSafety,
  habits: addHabits,
  summary: addSummary,
  closing: addClosing,
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(previewDir, { recursive: true });
  await Promise.all(
    Object.entries(assets).map(async ([key, assetPath]) => {
      const data = await fs.readFile(path.resolve(assetPath));
      assetDataUrls[key] = `data:image/png;base64,${data.toString("base64")}`;
    }),
  );
  const deck = Presentation.create({ slideSize: { width: W, height: H } });
  slides.forEach((slideData, index) => {
    builders[slideData.kind](deck.slides.add(), slideData, index + 1);
  });

  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(path.join(outDir, "output.pptx"));

  const previewPaths = [];
  for (let i = 0; i < deck.slides.items.length; i += 1) {
    const blob = await deck.export({ slide: deck.slides.items[i], format: "png" });
    const file = path.join(previewDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    await fs.writeFile(file, Buffer.from(await blob.arrayBuffer()));
    previewPaths.push(file);
  }

  await fs.writeFile(
    path.join(scratchDir, "preview-manifest.json"),
    JSON.stringify({ pptx: path.join(outDir, "output.pptx"), previewPaths }, null, 2),
  );
  console.log(JSON.stringify({ pptx: path.join(outDir, "output.pptx"), slides: deck.slides.items.length, previewDir }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
