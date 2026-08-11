"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="inline-flex items-center rounded-full bg-surface-muted border border-border p-0.5 text-xs font-semibold shadow-2xs">
      <div className="px-2 py-1 text-ink-muted flex items-center space-x-1">
        <Globe className="w-3.5 h-3.5 text-brand" />
      </div>
      <button
        onClick={() => setLocale("en")}
        className={`px-2.5 py-1 rounded-full text-sm font-bold transition-all cursor-pointer ${
          locale === "en"
            ? "bg-white text-ink shadow-xs border border-border"
            : "text-ink-muted hover:text-ink"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale("es")}
        className={`px-2.5 py-1 rounded-full text-sm font-bold transition-all cursor-pointer ${
          locale === "es"
            ? "bg-brand text-white shadow-xs"
            : "text-ink-muted hover:text-ink"
        }`}
      >
        ES (Español)
      </button>
    </div>
  );
}
