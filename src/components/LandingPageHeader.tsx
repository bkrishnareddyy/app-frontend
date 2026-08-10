"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Code2, Bot } from "lucide-react";
import { ApiStatusDrawer } from "./ApiStatusDrawer";

import { useLanguage } from "@/lib/i18n/LanguageContext";

export function LandingPageHeader() {
  const [isApiDrawerOpen, setIsApiDrawerOpen] = useState(false);
  const { t } = useLanguage();

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#F5F5F7]/80 backdrop-blur-md border-b border-[#E5E5EA]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-xl bg-[#0071E3] flex items-center justify-center text-white shadow-md shadow-[#0071E3]/20 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1D1D1F]">Qubere</span>
          </Link>

          <nav className="flex items-center space-x-3">
            <button
              onClick={() => setIsApiDrawerOpen(true)}
              className="px-4 py-2 text-sm font-bold bg-white hover:bg-slate-50 text-[#0071E3] border border-[#E5E5EA] rounded-full shadow-2xs transition-all flex items-center space-x-1.5 cursor-pointer hover:scale-105"
            >
              <Code2 className="w-4 h-4" />
              <span>{t.header.apiButton}</span>
            </button>

            <Link
              href="/agents"
              className="px-4 py-2 text-sm font-bold bg-white hover:bg-slate-50 text-[#0071E3] border border-[#E5E5EA] rounded-full shadow-2xs transition-all flex items-center space-x-1.5 cursor-pointer hover:scale-105"
            >
              <Bot className="w-4 h-4" />
              <span>{t.header.agentsButton}</span>
            </Link>

            <Link
              href="/sign-in"
              className="px-4 py-2 text-sm font-medium bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {t.header.signIn}
            </Link>
          </nav>
        </div>
      </header>

      <ApiStatusDrawer isOpen={isApiDrawerOpen} onClose={() => setIsApiDrawerOpen(false)} />
    </>
  );
}
