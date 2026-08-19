import { defineCatalog } from "@/i18n";
import { manualEn } from "./en/manual";
import { manualZhCN } from "./zh-CN/manual";

export const manualMessages = defineCatalog(manualEn, manualZhCN);
export type ManualMessageKey = keyof typeof manualEn;
