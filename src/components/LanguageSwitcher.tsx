"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="inline-flex items-center rounded-full bg-[#F5F5F7] border border-[#E5E5EA] p-0.5 text-xs font-semibold shadow-2xs">
      <div className="px-2 py-1 text-[#86868B] flex items-center space-x-1">
        <Globe className="w-3.5 h-3.5 text-[#0071E3]" />
      </div>
      <button
        onClick={() => setLocale("en")}
        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
          locale === "en"
            ? "bg-white text-[#1D1D1F] shadow-xs border border-[#E5E5EA]"
            : "text-[#86868B] hover:text-[#1D1D1F]"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLocale("es")}
        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
          locale === "es"
            ? "bg-[#0071E3] text-white shadow-xs"
            : "text-[#86868B] hover:text-[#1D1D1F]"
        }`}
      >
        ES (Español)
      </button>
    </div>
  );
}
