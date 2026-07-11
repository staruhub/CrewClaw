// weather.mjs — a structured Quick Utility weather source (§5.3 Weather Card). Uses wttr.in's
// JSON format (?format=j1) — free, no API key — so it works even when the LLM provider's quota
// is exhausted (it is NOT a model call). Returns a small structured card, not prose.
//
// v0.11 修复（实测用户卡点）：
//  1) "明天天气呢" 剥词后残留 "呢" 被当城市名 → wttr.in 模糊解析成 Maojiadian。语气词全剥。
//  2) 城市名曾用 wttr.in nearest_area（威妥玛拼音 "Chungshankuchih"）→ 改用用户问的原名。
//  3) 只会答当天 → j1 自带 3 天预报（weather[0..2]），明天/后天按预报日诚实作答；
//     更远（大后天/下周）返回 null 交给模型+工具。条件描述优先 wttr.in 的 lang=zh 中文。
const CONDITION_ZH = {
  Sunny: "晴",
  Clear: "晴",
  "Partly cloudy": "多云",
  "Partly Cloudy": "多云",
  Cloudy: "多云",
  Overcast: "阴",
  Mist: "薄雾",
  Fog: "雾",
  Freezing: "冰冻",
  "Patchy rain possible": "局部有雨",
  "Patchy rain nearby": "局部有雨",
  "Light rain": "小雨",
  "Light drizzle": "毛毛雨",
  "Moderate rain": "中雨",
  "Heavy rain": "大雨",
  "Light snow": "小雪",
  "Moderate snow": "中雪",
  "Heavy snow": "大雪",
  "Thundery outbreaks possible": "可能雷阵雨",
  "Patchy light rain": "零星小雨",
  "Light rain shower": "小阵雨",
  "Moderate or heavy rain shower": "中到大阵雨",
  "Patchy light drizzle": "零星毛毛雨",
  Thunderstorm: "雷暴",
  "Moderate or heavy rain with thunder": "雷雨",
};

// Pull a city out of a weather question; null if it isn't a weather ask.
export function weatherCity(message) {
  const m = String(message || "");
  if (!/天气|weather|气温|温度/i.test(m)) return null;
  const city = m
    .replace(
      /今天|明天|后天|现在|当前|的|天气|气温|温度|怎么样|咋样|如何|预报|查一下|查查|查询|看看|帮我|请问|多少度|weather|in /gi,
      ""
    )
    // 语气词/助词必须剥干净——残留的"呢"曾被 wttr.in 当城市名解析成毛家店（真实事故）。
    .replace(/[呢吧啊嘛哦哈呀哇]/g, "")
    .replace(/[?？。.,，!！、\s]/g, "")
    .trim();
  return city || null;
}

// 天气问句指向哪一天：0=今天/现在 1=明天 2=后天；更远（j1 只有 3 天）→ null（交给模型）。
export function weatherDay(message) {
  const m = String(message || "");
  if (/大后天|下周|下星期|next week/i.test(m)) return null;
  if (/后天/.test(m)) return 2;
  if (/明天|tomorrow/i.test(m)) return 1;
  return 0;
}

export async function fetchWeatherCard(
  city,
  { fetchImpl = fetch, day = 0 } = {}
) {
  if (!city || day === null || day === undefined) return null;
  try {
    // lang=zh 让 wttr.in 直接给中文天气描述（lang_zh 字段），映射表只作回退。
    const res = await fetchImpl(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`,
      {
        headers: { "User-Agent": "curl/8" }, // wttr.in serves JSON to curl-like clients
      }
    );
    if (!res || !res.ok) return null;
    const data = await res.json();
    const zhDesc = o => o?.lang_zh?.[0]?.value?.trim() || "";
    const enDesc = o => o?.weatherDesc?.[0]?.value?.trim() || "";
    const localize = o => zhDesc(o) || CONDITION_ZH[enDesc(o)] || enDesc(o);

    if (day === 0) {
      const cur = data?.current_condition?.[0];
      if (!cur) return null;
      return {
        city, // 用用户问的城市名——nearest_area 是威妥玛拼音（Chungshankuchih），不给用户看
        temp_c: Number(cur.temp_C),
        feels_c: Number(cur.FeelsLikeC),
        humidity: Number(cur.humidity),
        wind_kmph: Number(cur.windspeedKmph),
        condition: localize(cur),
        source: "wttr.in",
      };
    }

    // 预报日：j1 weather[day] 带 date/maxtempC/mintempC 与 hourly；取正午时段作代表状况。
    const fc = data?.weather?.[day];
    if (!fc) return null;
    const noon =
      fc.hourly?.[Math.min(4, (fc.hourly?.length || 1) - 1)] || fc.hourly?.[0];
    return {
      city,
      label: day === 1 ? "明天" : "后天",
      date: fc.date,
      min_c: Number(fc.mintempC),
      max_c: Number(fc.maxtempC),
      condition: noon ? localize(noon) : "",
      source: "wttr.in",
    };
  } catch {
    return null;
  }
}
