// tui/chat-demo.mjs — a vertical slice of the full-screen chat, driven by a SCRIPTED
// stream (no real model / input yet). Proves the component composition end-to-end:
// sticky Header + <Static> scrollback (user bubble + assistant w/ list) + a dim tool
// line + a live streaming assistant message with caret. Visual retest on a real TTY:
//   FORCE_COLOR=1 node tui/chat-demo.mjs
import React from "react";
import { render, Box, Static } from "ink";
import htm from "htm";
import {
  Header,
  UserMessage,
  AssistantMessage,
  ToolLine,
} from "./components.mjs";

const html = htm.bind(React.createElement);

// stub renderer until codex's ui-markdown.renderMessage lands (DI keeps this testable now)
const stubRender = text =>
  String(text)
    .split("\n")
    .map(l => "   " + l);

const committed = [
  { role: "user", text: "查一下最近的大模型发布" },
  {
    role: "assistant",
    text: "我先搜一下最近一周的官方动态。\n\n找到三条:\n- A 模型\n- B 模型\n- C 模型",
  },
];

let done;
function Demo() {
  const [live, setLive] = React.useState("");
  const [tools, setTools] = React.useState([]);
  React.useEffect(() => {
    const toks = [
      "根据",
      "刚才",
      "的",
      "搜索",
      "，",
      "本周",
      "共",
      "三家",
      "发布",
      "了",
      "新",
      "模型",
      "……",
    ];
    let i = 0;
    const tn = setTimeout(
      () =>
        setTools([
          { text: "⌕ web_search「最近发布」(3 处)", status: "success" },
        ]),
      180
    );
    const t = setInterval(() => {
      if (i < toks.length) setLive(s => s + toks[i++]);
      else {
        clearInterval(t);
        setTimeout(() => done && done(), 100);
      }
    }, 30);
    return () => {
      clearInterval(t);
      clearTimeout(tn);
    };
  }, []);
  return html`
    <${Box} flexDirection="column">
      <${Header} name="AI 落地鲸" tokens=${12840} ctxPct=${6} costText="$0.04" />
      <${Static} items=${committed}>
        ${(m, i) =>
          m.role === "user"
            ? html`<${UserMessage} key=${i} text=${m.text} />`
            : html`<${AssistantMessage}
                key=${i}
                name="鲸"
                lines=${stubRender(m.text)}
              />`}
      </>
      ${tools.map((t, i) => html`<${ToolLine} key=${i} text=${t.text} status=${t.status} />`)}
      <${AssistantMessage} name="鲸" lines=${stubRender(live)} caret=${true} />
    </>
  `;
}

const app = render(html`<${Demo} />`);
done = app.unmount;
await app.waitUntilExit();
console.log("[chat-demo] rendered & exited cleanly");
