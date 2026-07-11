// Foundation spike — de-risk Ink 7 + React 19 + htm (NO build step) in the plain-node
// runtime, BEFORE rewriting `crew chat` as a full-screen Ink app. Proves: ink imports
// and renders under `node` with no transpiler; htm binds to React.createElement; a
// <Static> scrollback (commit-once, never repaint) coexists with a live streaming line
// (the OpenTUI commit-to-scrollback pattern, Ink-flavored). Renders, streams, exits.
//
//   node packages/runtime/tui/spike.mjs
import React from "react";
import { render, Box, Text, Static } from "ink";
import htm from "htm";

const html = htm.bind(React.createElement);

let done;
function Spike() {
  const [live, setLive] = React.useState("");
  // Already-finalized turns: rendered ONCE via <Static>, then never touched again.
  const committed = [
    "▎ 你: 给我一段流式测试",
    "鲸 › 第一条已定稿消息——已经沉进 scrollback，永不重绘。",
  ];
  React.useEffect(() => {
    const toks = [
      "正在",
      "流式",
      "地",
      "渲染",
      "一条",
      "会",
      "自动",
      "换行",
      "的",
      "长",
      "消息",
      "……",
    ];
    let i = 0;
    const t = setInterval(() => {
      if (i < toks.length) setLive(s => s + toks[i++]);
      else {
        clearInterval(t);
        setTimeout(() => done && done(), 60);
      }
    }, 25);
    return () => clearInterval(t);
  }, []);
  return html`
    <${Box} flexDirection="column">
      <${Static} items=${committed}>
        ${(item, idx) => html`<${Text} key=${idx}>${item}</>`}
      </>
      <${Box} marginTop=${1}>
        <${Text} color="magenta">鲸 › </>
        <${Text}>${live}</>
        <${Text} dimColor> ●</>
      </>
    </>
  `;
}

const app = render(html`<${Spike} />`);
done = app.unmount;
await app.waitUntilExit();
console.log("[spike] ink7 + react19 + htm: rendered & exited cleanly");
