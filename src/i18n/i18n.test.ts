import { describe, expect, it } from "vitest";
import { formatMessage } from "./index";
import { adminEn } from "./locales/en/admin";
import { commonEn } from "./locales/en/common";
import { hireEn } from "./locales/en/hire";
import { homeEn } from "./locales/en/home";
import { marketplaceEn } from "./locales/en/marketplace";
import { operationsEn } from "./locales/en/operations";
import { workbenchEn } from "./locales/en/workbench";
import { adminZhCN } from "./locales/zh-CN/admin";
import { commonZhCN } from "./locales/zh-CN/common";
import { hireZhCN } from "./locales/zh-CN/hire";
import { homeZhCN } from "./locales/zh-CN/home";
import { marketplaceZhCN } from "./locales/zh-CN/marketplace";
import { operationsZhCN } from "./locales/zh-CN/operations";
import { workbenchZhCN } from "./locales/zh-CN/workbench";
import {
  defaultLocale,
  detectLocale,
  isLocale,
  supportedLocales,
} from "./locale";

describe("locale selection", () => {
  it("supports only the shipped locales", () => {
    expect(supportedLocales).toEqual(["en", "zh-CN"]);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-CN")).toBe(true);
    expect(isLocale("zh")).toBe(false);
  });

  it("prefers a valid saved locale", () => {
    expect(detectLocale("zh-CN", "en-US")).toBe("zh-CN");
    expect(detectLocale("en", "zh-CN")).toBe("en");
  });

  it("falls back to the browser language and then English", () => {
    expect(detectLocale(null, "zh-Hans-CN")).toBe("zh-CN");
    expect(detectLocale("invalid", "fr-FR")).toBe(defaultLocale);
    expect(detectLocale()).toBe(defaultLocale);
  });
});

describe("message formatting", () => {
  it("interpolates named values", () => {
    expect(
      formatMessage("Review {employee} after {count} tasks.", {
        employee: "Research Crab",
        count: 3,
      })
    ).toBe("Review Research Crab after 3 tasks.");
  });

  it("keeps unknown placeholders visible", () => {
    expect(formatMessage("Cost: {amount}")).toBe("Cost: {amount}");
  });
});

describe("catalog parity", () => {
  const catalogs = [
    ["common", commonEn, commonZhCN],
    ["home", homeEn, homeZhCN],
    ["marketplace", marketplaceEn, marketplaceZhCN],
    ["hire", hireEn, hireZhCN],
    ["operations", operationsEn, operationsZhCN],
    ["admin", adminEn, adminZhCN],
    ["workbench", workbenchEn, workbenchZhCN],
  ] as const;

  function placeholders(message: string) {
    return [...message.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort();
  }

  it.each(catalogs)(
    "%s has matching keys and no locale-only placeholders",
    (_name, english, chinese) => {
      expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        const englishPlaceholders = placeholders(english[key]);
        for (const placeholder of placeholders(chinese[key])) {
          expect(englishPlaceholders, key).toContain(placeholder);
        }
      }
    }
  );
});
