import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { marketplaceEn } from "./locales/en/marketplace";
import { marketplaceZhCN } from "./locales/zh-CN/marketplace";

const localKpiImplementation =
  /useEmployeePerformance|taskCountText|acceptanceText|averageCostText|kpiStateText/;
const unavailableLocalKpiCopy =
  /unavailable|local KPI|receipt-backed KPI|不可用|本地 KPI|带回执 KPI/i;

describe("public marketplace facts", () => {
  it("keeps local KPI reads out of public discovery surfaces", () => {
    const publicDiscoverySources = [
      join(process.cwd(), "src", "components", "employee", "EmployeeCard.tsx"),
      join(process.cwd(), "src", "pages", "Marketplace.tsx"),
      join(process.cwd(), "src", "pages", "Search.tsx"),
    ];

    for (const source of publicDiscoverySources) {
      expect(readFileSync(source, "utf8"), source).not.toMatch(
        localKpiImplementation
      );
    }
  });

  it("describes comparisons using public registry facts", () => {
    const publicCopy = [
      marketplaceEn.consoleFooter,
      marketplaceEn.compareDescription,
      marketplaceEn.searchComparisonDescription,
      marketplaceZhCN.consoleFooter,
      marketplaceZhCN.compareDescription,
      marketplaceZhCN.searchComparisonDescription,
    ];

    for (const copy of publicCopy) {
      expect(copy).not.toMatch(unavailableLocalKpiCopy);
    }
  });
});
