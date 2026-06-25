function asText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

export function proseText(markdown) {
  const tick = String.fromCharCode(96);
  return asText(markdown)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .split(tick)
    .join(" ")
    .replace(/[#*>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function linkCount(markdown) {
  const text = asText(markdown);
  let count = 0;
  let index = text.indexOf("](");
  while (index !== -1) {
    count += 1;
    index = text.indexOf("](", index + 2);
  }
  return count;
}

export function hasSpaMarker(html) {
  if (typeof html !== "string") return false;
  return (
    html.includes("__NEXT_DATA__") ||
    html.includes("__NUXT__") ||
    html.includes("window.__INITIAL_STATE__") ||
    html.includes("data-reactroot") ||
    html.includes("ng-version") ||
    /<div id="(root|app|__next|__nuxt)"[^>]*>\s*<\/div>/i.test(html)
  );
}

export function isJsShell({ markdown = "", html = "" } = {}) {
  const prose = proseText(markdown);
  if (prose.length >= 300) return false;
  return hasSpaMarker(html) || linkCount(markdown) > prose.length / 20;
}

export function routeBySize(charLen) {
  if (charLen < 5000) return "full";
  if (charLen < 500000) return "extract";
  if (charLen < 2000000) return "chunk";
  return "reject";
}

export function extractPrompt({ task = "", fields = [] } = {}) {
  const fieldList = Array.isArray(fields) ? fields.map(String).filter(Boolean) : [];
  const target = fieldList.length ? fieldList.join("、") : "与任务相关的事实";
  const taskText = asText(task).trim() || "当前任务";
  return "请从网页正文中抽取信息，任务是：" + taskText + "。需要字段：" + target + "。保留可追溯的来源线索，例如标题、段落语境、日期、价格单位、表格行列或链接文字。缺失字段标为 unknown。不要编造，不要补全没有证据的内容。删除导航、广告、页脚、订阅提示和模板化样板文本，只输出对任务有用的事实。";
}
