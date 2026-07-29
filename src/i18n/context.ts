import { createContext } from "react";
import type { Locale } from "./locale";
import type { MessageValues } from "./format";

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  format: (message: string, values?: MessageValues) => string;
  formatDate: (
    value: Date | number | string,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);
