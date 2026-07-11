// Weather Card source (§5.3): weatherCity pulls a city out of a 天气 ask; fetchWeatherCard parses
// wttr.in's j1 JSON into a structured card. Mocked fetch — no network in the unit test.
import assert from "node:assert/strict";
import { weatherCity, weatherDay, fetchWeatherCard } from "../weather.mjs";

assert.equal(weatherCity("杭州天气"), "杭州");
assert.equal(weatherCity("北京今天天气怎么样"), "北京");
assert.equal(weatherCity("杭州天气？"), "杭州");
assert.equal(weatherCity("现在几点了"), null, "non-weather → null");
assert.equal(weatherCity("帮我写报告"), null);
// v0.11 实测事故回归："呢"残留曾被当城市名（wttr.in 解析成 Maojiadian）。语气词必须剥净。
assert.equal(
  weatherCity("明天天气呢"),
  null,
  "no city in the ask → null (呢 must not survive as a city)"
);
assert.equal(
  weatherCity("看看中山天气呢"),
  "中山",
  "particles stripped, real city kept"
);

// 预报日解析：0=今天 1=明天 2=后天；更远 → null（j1 只有 3 天，交给模型）。
assert.equal(weatherDay("中山天气"), 0);
assert.equal(weatherDay("明天中山天气"), 1);
assert.equal(weatherDay("后天呢"), 2);
assert.equal(weatherDay("大后天天气"), null, "beyond j1's 3 days → model");
assert.equal(weatherDay("下周天气"), null);

const J1 = {
  current_condition: [
    {
      temp_C: "20",
      FeelsLikeC: "19",
      humidity: "60",
      windspeedKmph: "10",
      weatherDesc: [{ value: "Partly cloudy" }],
    },
  ],
  nearest_area: [{ areaName: [{ value: "Chungshankuchih" }] }],
  weather: [
    {
      date: "2026-07-07",
      mintempC: "24",
      maxtempC: "31",
      hourly: [
        {},
        {},
        {},
        {},
        { weatherDesc: [{ value: "Light rain shower" }] },
      ],
    },
    {
      date: "2026-07-08",
      mintempC: "25",
      maxtempC: "32",
      hourly: [
        {},
        {},
        {},
        {},
        {
          weatherDesc: [{ value: "Thundery outbreaks possible" }],
          lang_zh: [{ value: "可能雷阵雨" }],
        },
      ],
    },
    {
      date: "2026-07-09",
      mintempC: "25",
      maxtempC: "30",
      hourly: [
        {},
        {},
        {},
        {},
        { weatherDesc: [{ value: "Moderate or heavy rain shower" }] },
      ],
    },
  ],
};

{
  const fetchImpl = async () => ({ ok: true, json: async () => J1 });
  const card = await fetchWeatherCard("中山", { fetchImpl });
  assert.equal(card.temp_c, 20);
  assert.equal(card.feels_c, 19);
  assert.equal(card.humidity, 60);
  assert.equal(card.condition, "多云", "English condition mapped to Chinese");
  // v0.11 回归：城市名用用户问的原名，不用 nearest_area 的威妥玛拼音。
  assert.equal(
    card.city,
    "中山",
    "user's city name, not wttr.in's Chungshankuchih"
  );
  assert.equal(card.source, "wttr.in");
}

{
  // 明天：预报卡带 label/date/温度区间；lang_zh 优先。
  const fetchImpl = async () => ({ ok: true, json: async () => J1 });
  const card = await fetchWeatherCard("中山", { fetchImpl, day: 1 });
  assert.equal(card.label, "明天");
  assert.equal(card.date, "2026-07-08");
  assert.equal(card.min_c, 25);
  assert.equal(card.max_c, 32);
  assert.equal(card.condition, "可能雷阵雨", "lang_zh preferred when present");
  // 后天：无 lang_zh 时映射表回退。
  const card2 = await fetchWeatherCard("中山", { fetchImpl, day: 2 });
  assert.equal(card2.label, "后天");
  assert.equal(
    card2.condition,
    "中到大阵雨",
    "mapping fallback covers rain-shower phrases"
  );
}

{
  const fetchImpl = async () => ({ ok: true, json: async () => J1 });
  // lang=zh 请求参数带上（wttr.in 直接回中文描述）。
  let seenUrl = "";
  await fetchWeatherCard("中山", {
    fetchImpl: async url => {
      seenUrl = String(url);
      return { ok: true, json: async () => J1 };
    },
  });
  assert.ok(
    seenUrl.includes("lang=zh"),
    "request asks wttr.in for Chinese descriptions"
  );
  assert.equal(
    await fetchWeatherCard("x", { fetchImpl: async () => ({ ok: false }) }),
    null,
    "non-ok → null"
  );
  assert.equal(
    await fetchWeatherCard("x", {
      fetchImpl: async () => {
        throw new Error("net");
      },
    }),
    null,
    "network error → null, no throw"
  );
  assert.equal(await fetchWeatherCard("", {}), null, "empty city → null");
  assert.equal(
    await fetchWeatherCard("中山", { fetchImpl, day: null }),
    null,
    "day=null → card declines (model handles)"
  );
}

console.log("weather tests passed");
