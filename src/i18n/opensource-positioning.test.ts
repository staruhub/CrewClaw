import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hireEn } from "./locales/en/hire";
import { homeEn } from "./locales/en/home";
import { marketplaceEn } from "./locales/en/marketplace";
import { hireZhCN } from "./locales/zh-CN/hire";
import { homeZhCN } from "./locales/zh-CN/home";
import { marketplaceZhCN } from "./locales/zh-CN/marketplace";

const retiredCommerceCopy =
  /\$19|billing|checkout|paid (?:plan|seat|entitlement)|payment processor|计费|结账|付费(?:套餐|席位|权益)|支付处理器/i;

describe("open-source product positioning", () => {
  it("keeps retired commerce copy out of public product catalogs", () => {
    const catalogs = [
      homeEn,
      homeZhCN,
      hireEn,
      hireZhCN,
      marketplaceEn,
      marketplaceZhCN,
    ];

    for (const catalog of catalogs) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(String(value), key).not.toMatch(retiredCommerceCopy);
      }
    }
  });

  it("keeps retired pricing language out of the public concept video", () => {
    const publicDemoSources = [
      join(process.cwd(), "scripts", "render-demo-video.mjs"),
      join(process.cwd(), "docs", "assets", "crewclaw-demo.zh-CN.srt"),
    ];

    for (const source of publicDemoSources) {
      expect(readFileSync(source, "utf8"), source).not.toMatch(
        /\b(?:price|pricing)\b|价格/i
      );
    }
  });
});
