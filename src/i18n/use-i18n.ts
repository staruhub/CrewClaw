import { useCallback, useContext } from "react";
import { I18nContext } from "./context";
import type { LocalizedCatalog, MessageValues } from "./format";

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
}

export function useMessages<T extends LocalizedCatalog>(catalog: T) {
  const { locale, format } = useI18n();

  return useCallback(
    (key: keyof T["en"] & string, values?: MessageValues) => {
      const message = catalog[locale][key] ?? catalog.en[key];
      return format(message ?? key, values);
    },
    [catalog, format, locale]
  );
}
