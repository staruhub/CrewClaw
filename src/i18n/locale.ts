export const supportedLocales = ["en", "zh-CN"] as const;

export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "en";
export const localeStorageKey = "crewclaw.locale.v1";

export function isLocale(value: unknown): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function detectLocale(
  storedLocale?: string | null,
  browserLocale?: string | null
): Locale {
  if (isLocale(storedLocale)) return storedLocale;
  return browserLocale?.toLowerCase().startsWith("zh")
    ? "zh-CN"
    : defaultLocale;
}

export function readLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale;

  try {
    return detectLocale(
      window.localStorage.getItem(localeStorageKey),
      window.navigator.language
    );
  } catch {
    return detectLocale(null, window.navigator.language);
  }
}

export function writeLocale(locale: Locale) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Language selection still works for this session when storage is blocked.
  }
}

export function applyDocumentLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}
