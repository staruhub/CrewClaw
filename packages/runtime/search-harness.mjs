export const RESEARCH_FIELDS = [
  { key: "exists", label: "是否真实存在", required: true },
  { key: "official_name", label: "官方名称", required: true },
  { key: "model_id", label: "模型ID", required: false },
  { key: "price", label: "价格", required: true },
  { key: "context", label: "上下文", required: false },
  { key: "capability", label: "能力", required: false },
  { key: "source", label: "来源", required: true },
  { key: "confidence", label: "置信度", required: true },
  { key: "scenario", label: "适用场景", required: false },
  { key: "risk", label: "风险", required: false },
  { key: "recommendation", label: "建议", required: false }
];

export const FAILURE_PLAYBOOK = [
  { step: "exact_phrase", label: "精确短语搜索" },
  { step: "official_domain", label: "官方域名搜索" },
  { step: "zh_alias", label: "中文别名搜索" },
  { step: "en_alias", label: "英文别名搜索" },
  { step: "product_id", label: "产品ID搜索" },
  { step: "news_source", label: "新闻来源搜索" },
  { step: "doc_source", label: "文档来源搜索" },
  { step: "community_source", label: "社区来源搜索" },
  { step: "js_render", label: "JS渲染搜索" },
  { step: "screenshot_or_cache", label: "截图或缓存搜索" },
  { step: "give_up_with_trace", label: "放弃并记录追踪" }
];

function pushUnique(out, seen, value) {
  const text = String(value ?? "").trim();
  if (!text || seen.has(text)) return;
  seen.add(text);
  out.push(text);
}

export function generateQueries({ entity, aliases = [], officialDomains = [], productIds = [] } = {}) {
  const name = String(entity ?? "").trim();
  if (!name) throw new Error("entity is required");

  const out = [];
  const seen = new Set();

  pushUnique(out, seen, name);
  for (const domain of officialDomains) {
    const cleanDomain = String(domain ?? "").trim();
    if (cleanDomain) pushUnique(out, seen, "site:" + cleanDomain + " " + name);
  }
  for (const alias of aliases) pushUnique(out, seen, alias);
  for (const productId of productIds) pushUnique(out, seen, productId);
  pushUnique(out, seen, name + " 最新");
  pushUnique(out, seen, name + " 官方");

  return out;
}

export function nextRecovery(attemptIndex) {
  return FAILURE_PLAYBOOK[attemptIndex] ?? null;
}

export function formatDeliverable(fields) {
  const values = fields ?? {};
  const lines = [];
  const nl = String.fromCharCode(10);

  for (const field of RESEARCH_FIELDS) {
    const hasValue = Object.prototype.hasOwnProperty.call(values, field.key);
    const value = hasValue ? values[field.key] : "unknown";
    lines.push("## " + field.label + nl + String(value) + nl + nl);
  }

  return lines.join("");
}
