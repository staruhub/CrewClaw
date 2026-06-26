// weather.mjs — a structured Quick Utility weather source (§5.3 Weather Card). Uses wttr.in's
// JSON format (?format=j1) — free, no API key — so it works even when the LLM provider's quota
// is exhausted (it is NOT a model call). Returns a small structured card, not prose.
const CONDITION_ZH = {
  Sunny: "晴", Clear: "晴", "Partly cloudy": "多云", Cloudy: "多云", Overcast: "阴",
  Mist: "薄雾", Fog: "雾", Freezing: "冰冻", "Patchy rain possible": "局部有雨",
  "Patchy rain nearby": "局部有雨", "Light rain": "小雨", "Light drizzle": "毛毛雨",
  "Moderate rain": "中雨", "Heavy rain": "大雨", "Light snow": "小雪", "Moderate snow": "中雪",
  "Heavy snow": "大雪", "Thundery outbreaks possible": "可能雷阵雨", "Patchy light rain": "零星小雨",
};

// Pull a city out of a weather question; null if it isn't a weather ask.
export function weatherCity(message) {
  const m = String(message || "");
  if (!/天气|weather|气温|温度/i.test(m)) return null;
  const city = m
    .replace(/今天|明天|后天|现在|当前|的|天气|气温|温度|怎么样|咋样|如何|预报|查一下|查查|查询|看看|多少度|weather|in /gi, "")
    .replace(/[?？。.,，!！、\s]/g, "")
    .trim();
  return city || null;
}

export async function fetchWeatherCard(city, { fetchImpl = fetch } = {}) {
  if (!city) return null;
  try {
    const res = await fetchImpl(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      headers: { "User-Agent": "curl/8" }, // wttr.in serves JSON to curl-like clients
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const cur = data?.current_condition?.[0];
    if (!cur) return null;
    const desc = cur.weatherDesc?.[0]?.value?.trim() || "";
    const area = data?.nearest_area?.[0]?.areaName?.[0]?.value;
    return {
      city: area || city,
      temp_c: Number(cur.temp_C),
      feels_c: Number(cur.FeelsLikeC),
      humidity: Number(cur.humidity),
      wind_kmph: Number(cur.windspeedKmph),
      condition: CONDITION_ZH[desc] || desc,
      source: "wttr.in",
    };
  } catch {
    return null;
  }
}
