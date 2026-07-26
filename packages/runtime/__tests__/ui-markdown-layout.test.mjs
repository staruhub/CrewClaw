import test from "node:test";
import assert from "node:assert/strict";

import { setContentWidth } from "../ui-layout.mjs";
import { renderMessage } from "../ui-markdown.mjs";
import { visibleLen } from "../ui.mjs";

test("markdown rendering honors negotiated pane width without SGR 0 background resets", () => {
  setContentWidth(72);
  try {
    const lines = renderMessage(
      '| 业务/产品 | 技术负责人 | RACI |\n|---|---|---|\n| 增长方案 | 平台组 | **A/R** |\n\n```json\n{"ok": true}\n```',
      { color: true }
    );
    assert.doesNotMatch(lines.join("\n"), /\*\*A\/R\*\*/);
    assert.doesNotMatch(lines.join("\n"), /\x1b\[0m/);
    assert.ok(lines.every(line => visibleLen(line) <= 75));

    const fence = lines.slice(-3).filter(line => /[┌└].*[┐┘]/.test(line));
    assert.equal(fence.length, 2);
    assert.equal(visibleLen(fence[0]), visibleLen(fence[1]));
  } finally {
    setContentWidth(null);
  }
});

test("wider negotiated panes preserve table headers instead of the old 100-column cap", () => {
  const source =
    "| 业务/产品负责人 | 技术负责人 | 安全与合规负责人 | 最终决策 |\n|---|---|---|---|\n| 张三 | 李四 | 王五 | **A/R** |";
  setContentWidth(132);
  try {
    const rendered = renderMessage(source, { color: false }).join("\n");
    assert.match(rendered, /业务\/产品负责人/);
    assert.match(rendered, /安全与合规负责人/);
    assert.doesNotMatch(rendered, /\*\*/);
    assert.ok(
      rendered.split("\n").every(line => visibleLen(line) <= 135),
      "table stays inside gutter plus negotiated content width"
    );
  } finally {
    setContentWidth(null);
  }
});
