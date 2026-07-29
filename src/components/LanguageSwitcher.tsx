import { commonEn } from "@/i18n/locales/en/common";
import { commonZhCN } from "@/i18n/locales/zh-CN/common";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

const commonMessages = {
  en: commonEn,
  "zh-CN": commonZhCN,
};

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const messages = commonMessages[locale];

  return (
    <div
      aria-label={messages.language}
      className={cn(
        "inline-flex items-center rounded-full border border-white/15 bg-[#0d0b0c]/92 p-1 font-mono text-[10px] shadow-lg backdrop-blur-xl",
        className
      )}
      data-testid="locale-switcher"
      role="group"
    >
      <button
        aria-label={messages.english}
        aria-pressed={locale === "en"}
        className={cn(
          "rounded-full px-2.5 py-1.5 transition-colors",
          locale === "en"
            ? "bg-[#ec9552] font-bold text-[#15100c]"
            : "text-[#aaa39a] hover:text-[#f2eee7]"
        )}
        onClick={() => setLocale("en")}
        type="button"
      >
        EN
      </button>
      <button
        aria-label={messages.chinese}
        aria-pressed={locale === "zh-CN"}
        className={cn(
          "rounded-full px-2.5 py-1.5 transition-colors",
          locale === "zh-CN"
            ? "bg-[#ec9552] font-bold text-[#15100c]"
            : "text-[#aaa39a] hover:text-[#f2eee7]"
        )}
        onClick={() => setLocale("zh-CN")}
        type="button"
      >
        中文
      </button>
    </div>
  );
}
