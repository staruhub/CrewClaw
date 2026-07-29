import { defineCatalog } from "@/i18n";
import { marketplaceEn } from "./en/marketplace";
import { marketplaceZhCN } from "./zh-CN/marketplace";

export const marketplaceMessages = defineCatalog(
  marketplaceEn,
  marketplaceZhCN
);
export type MarketplaceMessageKey = keyof typeof marketplaceEn;
