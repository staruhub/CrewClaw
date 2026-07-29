import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nContext, type I18nContextValue } from "./context";
import { formatMessage } from "./format";
import {
  applyDocumentLocale,
  isLocale,
  localeStorageKey,
  readLocale,
  writeLocale,
  type Locale,
} from "./locale";
import { commonEn } from "./locales/en/common";
import { commonZhCN } from "./locales/zh-CN/common";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);

  useEffect(() => {
    applyDocumentLocale(locale);
    writeLocale(locale);
    const messages = locale === "zh-CN" ? commonZhCN : commonEn;
    document.title = messages.metaTitle;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", messages.metaDescription);
  }, [locale]);

  useEffect(() => {
    const syncLocale = (event: StorageEvent) => {
      if (event.key === localeStorageKey && isLocale(event.newValue)) {
        setLocaleState(event.newValue);
      }
    };

    window.addEventListener("storage", syncLocale);
    return () => window.removeEventListener("storage", syncLocale);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      format: formatMessage,
      formatDate: (input, options) => {
        const date = input instanceof Date ? input : new Date(input);
        return Number.isNaN(date.getTime())
          ? String(input)
          : new Intl.DateTimeFormat(locale, options).format(date);
      },
      formatNumber: (input, options) =>
        new Intl.NumberFormat(locale, options).format(input),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
