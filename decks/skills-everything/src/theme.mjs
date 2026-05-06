export const W = 1920;
export const H = 1080;

export const assets = {
  cover: "scratch/assets/cover-skill-workshop.png",
  anatomy: "scratch/assets/anatomy-blueprint.png",
  scripts: "scratch/assets/scripts-workbench.png",
  governance: "scratch/assets/governance-control.png",
};

export const c = {
  bg: "#F7F2E8",
  ink: "#111827",
  muted: "#596273",
  faint: "#D8D0C0",
  code: "#172033",
  charcoal: "#151922",
  blue: "#2357FF",
  red: "#E23D28",
  green: "#087F5B",
  gold: "#C98316",
  paper: "#FFFDF7",
};

const font = "Hiragino Sans GB";
const mono = "Menlo";

export const type = {
  tiny: { fontFamily: mono, fontSize: 16, color: c.muted },
  label: { fontFamily: mono, fontSize: 20, color: c.blue, bold: true },
  title: { fontFamily: font, fontSize: 62, color: c.ink, bold: true },
  cover: { fontFamily: font, fontSize: 112, color: c.ink, bold: true },
  body: { fontFamily: font, fontSize: 30, color: c.ink },
  sub: { fontFamily: font, fontSize: 26, color: c.muted },
  code: { fontFamily: mono, fontSize: 28, color: "#E7F0FF" },
};
