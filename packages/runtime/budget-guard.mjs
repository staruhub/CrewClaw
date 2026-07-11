export const DEFAULT_RATES = { inputPerM: 15, outputPerM: 75 };

export function estimateCost(
  { promptTokens = 0, completionTokens = 0 },
  rates = DEFAULT_RATES
) {
  const tokens = promptTokens + completionTokens;
  const cost =
    (promptTokens / 1_000_000) * rates.inputPerM +
    (completionTokens / 1_000_000) * rates.outputPerM;

  return { tokens, cost };
}

export function checkBudget(spentCost, limitCost) {
  if (limitCost === null || limitCost === undefined) {
    return { ok: true, over: 0, remaining: null };
  }

  return {
    ok: spentCost <= limitCost,
    over: Math.max(0, spentCost - limitCost),
    remaining: limitCost - spentCost,
  };
}

export function formatBudget({ tokens, cost, limit }) {
  const dollar = String.fromCharCode(36);
  const tokenText = new Intl.NumberFormat("en-US").format(tokens);
  let out = "Cost: " + dollar + cost.toFixed(2) + " · " + tokenText + " tokens";
  if (typeof limit === "number") {
    out += " · 预算 " + dollar + limit.toFixed(2);
    if (cost > limit) out += " ⚠ 超预算";
  }
  return out;
}
