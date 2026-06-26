// Weather Card source (§5.3): weatherCity pulls a city out of a 天气 ask; fetchWeatherCard parses
// wttr.in's j1 JSON into a structured card. Mocked fetch — no network in the unit test.
import assert from "node:assert/strict";
import { weatherCity, fetchWeatherCard } from "../weather.mjs";

assert.equal(weatherCity("杭州天气"), "杭州");
assert.equal(weatherCity("北京今天天气怎么样"), "北京");
assert.equal(weatherCity("杭州天气？"), "杭州");
assert.equal(weatherCity("现在几点了"), null, "non-weather → null");
assert.equal(weatherCity("帮我写报告"), null);

{
  const j1 = {
    current_condition: [{ temp_C: "20", FeelsLikeC: "19", humidity: "60", windspeedKmph: "10", weatherDesc: [{ value: "Partly cloudy" }] }],
    nearest_area: [{ areaName: [{ value: "Hangzhou" }] }],
  };
  const fetchImpl = async () => ({ ok: true, json: async () => j1 });
  const card = await fetchWeatherCard("杭州", { fetchImpl });
  assert.equal(card.temp_c, 20);
  assert.equal(card.feels_c, 19);
  assert.equal(card.humidity, 60);
  assert.equal(card.condition, "多云", "English condition mapped to Chinese");
  assert.equal(card.city, "Hangzhou");
  assert.equal(card.source, "wttr.in");
}

{
  assert.equal(await fetchWeatherCard("x", { fetchImpl: async () => ({ ok: false }) }), null, "non-ok → null");
  assert.equal(await fetchWeatherCard("x", { fetchImpl: async () => { throw new Error("net"); } }), null, "network error → null, no throw");
  assert.equal(await fetchWeatherCard("", {}), null, "empty city → null");
}

console.log("weather tests passed");
